"""Action item extraction evaluation for meeting and orchestrator models.

Runs 20 realistic multi-speaker meeting transcripts through each model and compares
extracted action items against reference lists using item-level fuzzy F1, token P/R/F1,
owner coverage, and deadline coverage.

Usage:
  python eval_action_items.py --config models_config.json --out-dir ./action_items_results
  python eval_action_items.py --endpoint URL/v1 --model thejesraj/wos-meeting-32b --api_key KEY
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from pathlib import Path

import requests

from eval_metrics_common import rouge_macro_prf, rouge_single_prf

SYSTEM_MEETING = (
    "You are WOS Meeting, an expert meeting intelligence assistant. "
    "Extract all action items from the meeting transcript. "
    "For each action item include: the task, the responsible owner (person's name), "
    "and the deadline (date or relative timeframe). "
    "Format as a numbered list."
)

SYSTEM_MAIN = (
    "You are WOS, an intelligent AI assistant. "
    "Analyze this meeting transcript and extract all action items. "
    "For each action item, clearly state: what needs to be done, who is responsible, and by when."
)

# ---------------------------------------------------------------------------
# 20 realistic multi-speaker meeting transcripts with reference action items
# ---------------------------------------------------------------------------

TRANSCRIPTS = [
    {
        "id": "T01",
        "scenario": "Sprint planning — backend API team",
        "transcript": """
Alice (Tech Lead): Let's kick off the sprint. We have three big tickets this week.
Bob (Backend): I'll take the auth token refresh endpoint. Should be done by Wednesday.
Carol (Backend): I can handle the rate limiting middleware. I'll have a PR up by Thursday EOD.
Alice: Great. Bob, can you also set up the staging Redis instance before you start the auth work? That needs to happen today.
Bob: Sure, I'll do that this morning.
Dave (QA): Once Bob's auth endpoint is ready I'll write the integration tests. I'll need that by Wednesday to finish by Friday.
Alice: Carol, after the rate limiting PR, please update the API docs in Confluence. End of sprint, so by Friday.
Carol: Got it.
Alice: I'll schedule the sprint review for next Monday morning. Everyone confirm your calendar before EOD today.
""",
        "reference_items": [
            {"task": "Build auth token refresh endpoint", "owner": "Bob", "deadline": "Wednesday"},
            {"task": "Set up staging Redis instance", "owner": "Bob", "deadline": "today"},
            {"task": "Implement rate limiting middleware", "owner": "Carol", "deadline": "Thursday EOD"},
            {"task": "Write integration tests for auth endpoint", "owner": "Dave", "deadline": "Friday"},
            {"task": "Update API documentation in Confluence", "owner": "Carol", "deadline": "Friday"},
            {"task": "Schedule sprint review", "owner": "Alice", "deadline": "next Monday"},
            {"task": "Confirm sprint review calendar invite", "owner": "everyone", "deadline": "today"},
        ],
    },
    {
        "id": "T02",
        "scenario": "Q3 budget review — finance and department heads",
        "transcript": """
Sarah (CFO): We're 12% over budget in infrastructure. I need each department to submit revised forecasts.
Mark (Engineering): Engineering's overage is mostly GPU costs for the new ML pipeline. I'll put together a detailed breakdown by next Tuesday.
Sarah: Mark, also reach out to AWS about our enterprise discount — we should have renegotiated six months ago.
Mark: I'll email the AWS account team today.
Lisa (Product): Product is on track. I'll send our Q4 projection by end of week.
Sarah: Good. James, I need your ops cost reduction proposal by Thursday. We discussed cutting $50K from vendor contracts.
James (Ops): I'll have it ready Thursday noon.
Sarah: I'll consolidate everything and present to the board on the 15th. Mark, can you prepare the infrastructure slide deck by the 13th?
Mark: Yes, I'll have slides ready by the 13th.
""",
        "reference_items": [
            {"task": "Prepare engineering cost breakdown with GPU usage details", "owner": "Mark", "deadline": "next Tuesday"},
            {"task": "Contact AWS account team about enterprise discount", "owner": "Mark", "deadline": "today"},
            {"task": "Send Q4 product projection", "owner": "Lisa", "deadline": "end of week"},
            {"task": "Prepare ops vendor cost reduction proposal ($50K)", "owner": "James", "deadline": "Thursday noon"},
            {"task": "Prepare infrastructure slide deck for board", "owner": "Mark", "deadline": "the 13th"},
            {"task": "Consolidate forecasts and present to board", "owner": "Sarah", "deadline": "the 15th"},
        ],
    },
    {
        "id": "T03",
        "scenario": "Product roadmap review — product and engineering",
        "transcript": """
Priya (PM): We need to finalize the Q4 roadmap by Friday for the all-hands.
Tom (Engineering): The search overhaul is our biggest item. We need final requirements from product before we can scope it.
Priya: I'll send the requirements doc by tomorrow EOD, Tom.
Tom: Good. I'll have the engineering estimate ready by Thursday.
Nina (Design): I need to start on the search UI mockups. Can I get the requirements at the same time?
Priya: Yes, I'll CC you on the doc, Nina. Can you have initial mockups by Thursday for the roadmap deck?
Nina: Thursday works.
Priya: Ryan, can you update the roadmap slide deck once we have estimates? Should be ready by Friday morning.
Ryan (PM): I'll have the deck updated Friday by 9am.
Tom: One more thing — we need to deprecate the legacy API. I'll file the deprecation notice ticket today.
""",
        "reference_items": [
            {"task": "Send search feature requirements document", "owner": "Priya", "deadline": "tomorrow EOD"},
            {"task": "Prepare engineering estimate for search overhaul", "owner": "Tom", "deadline": "Thursday"},
            {"task": "Create initial search UI mockups", "owner": "Nina", "deadline": "Thursday"},
            {"task": "Update roadmap slide deck with estimates", "owner": "Ryan", "deadline": "Friday 9am"},
            {"task": "File legacy API deprecation notice ticket", "owner": "Tom", "deadline": "today"},
        ],
    },
    {
        "id": "T04",
        "scenario": "Customer escalation — support and engineering",
        "transcript": """
Maria (Support Lead): Acme Corp is threatening to churn. They've had three outages this month tied to our batch job scheduler.
Dev (Engineering): I identified the root cause — a race condition in the job queue. I can patch it by tomorrow.
Maria: Dev, can you send Acme a technical root cause analysis today? They're asking for it.
Dev: Sure, I'll draft the RCA and send it today by 3pm.
Maria: Thanks. Kelly, can you schedule a call with Acme's CTO for this week to walk through the fix?
Kelly (Customer Success): I'll reach out to them today and aim for a call by Wednesday.
Maria: Dev, after the patch is deployed, can you set up monitoring alerts so we catch this before it hits customers?
Dev: I'll add the alerts to our Datadog dashboard by end of this week.
Maria: Kelly, please send Acme a service credit for the outages — $5K — by end of day.
Kelly: Will do.
""",
        "reference_items": [
            {"task": "Patch race condition in job queue scheduler", "owner": "Dev", "deadline": "tomorrow"},
            {"task": "Draft and send technical root cause analysis to Acme", "owner": "Dev", "deadline": "today 3pm"},
            {"task": "Schedule call with Acme CTO", "owner": "Kelly", "deadline": "Wednesday"},
            {"task": "Set up Datadog monitoring alerts for job queue", "owner": "Dev", "deadline": "end of week"},
            {"task": "Send $5K service credit to Acme", "owner": "Kelly", "deadline": "end of day"},
        ],
    },
    {
        "id": "T05",
        "scenario": "Security incident response",
        "transcript": """
Alex (CISO): We had an unauthorized access event on the prod database at 2am. Currently contained.
Sam (Security): The vector was an unrotated API key from a decommissioned service. I'll rotate all service keys today.
Alex: Sam, I also need a full audit of all API keys and their last-used dates by Wednesday.
Sam: I'll have the audit spreadsheet by Wednesday COB.
Tina (DevOps): We should implement automatic key rotation. I can set up the rotation policy in Vault by next Friday.
Alex: Do it. Tina, also revoke the compromised key immediately if that hasn't happened.
Tina: Already revoked. Done at 2:15am.
Alex: Good. I'll file the incident report with our compliance team by EOD today. Jim, can you notify affected customers by tomorrow morning?
Jim (Legal/Compliance): I'll coordinate with the communications team and send notifications by 9am tomorrow.
Alex: Let's reconvene Friday to review the full post-mortem.
Sam: I'll have the post-mortem draft ready by Thursday so we can review before Friday.
""",
        "reference_items": [
            {"task": "Rotate all service API keys", "owner": "Sam", "deadline": "today"},
            {"task": "Audit all API keys and last-used dates", "owner": "Sam", "deadline": "Wednesday COB"},
            {"task": "Implement automatic key rotation policy in Vault", "owner": "Tina", "deadline": "next Friday"},
            {"task": "File incident report with compliance team", "owner": "Alex", "deadline": "EOD today"},
            {"task": "Notify affected customers", "owner": "Jim", "deadline": "9am tomorrow"},
            {"task": "Draft post-mortem document", "owner": "Sam", "deadline": "Thursday"},
            {"task": "Post-mortem review meeting", "owner": "Alex", "deadline": "Friday"},
        ],
    },
    {
        "id": "T06",
        "scenario": "New hire onboarding planning",
        "transcript": """
HR Lead (Jen): We have three engineers starting next Monday. Let's make sure onboarding is ready.
IT (Carlos): I'll have laptops configured and accounts provisioned by Friday.
Jen: Carlos, also set up their Slack, GitHub, and Jira access — include them in the engineering channels.
Carlos: I'll handle all of that by Friday afternoon.
Team Lead (Raj): I'll assign each new hire a buddy from the existing team by Wednesday. I'll send buddy assignments to Jen.
Jen: Great. Can you also prepare the 30-60-90 day goals doc for each hire, Raj?
Raj: I'll draft those by Thursday and share with you, Jen.
Jen: I'll send the new hires the welcome package with first-week schedule by Thursday EOD.
Raj: I'll schedule a team welcome lunch for next Tuesday.
""",
        "reference_items": [
            {"task": "Configure laptops and provision accounts for new hires", "owner": "Carlos", "deadline": "Friday"},
            {"task": "Set up Slack, GitHub, and Jira access for new hires", "owner": "Carlos", "deadline": "Friday afternoon"},
            {"task": "Assign onboarding buddies from existing team", "owner": "Raj", "deadline": "Wednesday"},
            {"task": "Prepare 30-60-90 day goals documents for each hire", "owner": "Raj", "deadline": "Thursday"},
            {"task": "Send welcome package and first-week schedule to new hires", "owner": "Jen", "deadline": "Thursday EOD"},
            {"task": "Schedule team welcome lunch", "owner": "Raj", "deadline": "next Tuesday"},
        ],
    },
    {
        "id": "T07",
        "scenario": "Data pipeline reliability review",
        "transcript": """
Lead Eng (Yuki): Our ETL pipeline failed three times last month causing downstream dashboard outages.
Data Eng (Paulo): The root cause is the Spark job running out of memory on large partition sizes. I can tune the partition config by Tuesday.
Yuki: Paulo, also add retry logic with exponential backoff. When can you do that?
Paulo: I'll add retries by Wednesday EOD.
Analyst (Fran): Can someone set up alerting so I know when the pipeline fails before I have to discover it manually?
Yuki: I'll set up PagerDuty alerts tied to the pipeline by Thursday.
Fran: Also, our dashboard shows stale data when it fails. Can we add a data freshness indicator?
Paulo: I'll add a freshness banner to the dashboard by Friday.
Yuki: Let's also document the runbook for pipeline failures. I'll write the first draft by end of next week.
Paulo: I'll review it once it's ready.
""",
        "reference_items": [
            {"task": "Tune Spark partition configuration to fix memory issues", "owner": "Paulo", "deadline": "Tuesday"},
            {"task": "Add retry logic with exponential backoff to ETL pipeline", "owner": "Paulo", "deadline": "Wednesday EOD"},
            {"task": "Set up PagerDuty alerts for pipeline failures", "owner": "Yuki", "deadline": "Thursday"},
            {"task": "Add data freshness indicator to dashboard", "owner": "Paulo", "deadline": "Friday"},
            {"task": "Write pipeline failure runbook", "owner": "Yuki", "deadline": "end of next week"},
            {"task": "Review pipeline runbook", "owner": "Paulo", "deadline": "after Yuki draft"},
        ],
    },
    {
        "id": "T08",
        "scenario": "Vendor selection — cloud storage migration",
        "transcript": """
IT Director (Helen): We need to decide on our cloud storage vendor by end of quarter. Three finalists: AWS S3, GCP, Azure Blob.
Procurement (Dan): I'll get final pricing from all three vendors by next Wednesday.
Helen: Good. Engineering, can you run a performance benchmark on all three by the same time?
Eng Lead (Omar): I'll have benchmark results by Wednesday. I'll test latency, throughput, and cost per GB.
Helen: Dan, also review the data residency compliance terms for each vendor — we need EU-region guarantees.
Dan: I'll include compliance review in the vendor packages by Wednesday.
Legal (Amy): Send me the final vendor contracts once you've chosen — I'll need three business days for review.
Helen: Noted. We'll make the decision in Thursday's meeting. Omar, prepare a two-pager comparison for that meeting.
Omar: I'll have the comparison doc ready by Wednesday EOD so you can review Thursday morning.
""",
        "reference_items": [
            {"task": "Get final pricing quotes from AWS, GCP, and Azure", "owner": "Dan", "deadline": "next Wednesday"},
            {"task": "Run performance benchmarks (latency, throughput, cost/GB) on all three vendors", "owner": "Omar", "deadline": "Wednesday"},
            {"task": "Review data residency and EU compliance terms for each vendor", "owner": "Dan", "deadline": "Wednesday"},
            {"task": "Prepare two-pager vendor comparison document", "owner": "Omar", "deadline": "Wednesday EOD"},
            {"task": "Review final vendor contracts", "owner": "Amy", "deadline": "3 business days after selection"},
            {"task": "Make vendor selection decision", "owner": "Helen", "deadline": "Thursday meeting"},
        ],
    },
    {
        "id": "T09",
        "scenario": "Mobile app launch readiness",
        "transcript": """
PM (Rina): iOS launch is in two weeks. Let's run through the checklist.
iOS Lead (Jake): Core features are done. I have three bugs left, all P2. I'll close them by Monday.
QA (Mel): I need build 4.2.1 to finish regression testing. If I get it Monday, I can complete QA by Wednesday.
Jake: I'll submit 4.2.1 to TestFlight by Sunday night.
Rina: Good. Marketing, where are we on the App Store listing?
Marketing (Chen): Screenshots and copy are done. I just need the final app icon from design.
Design (Ava): I'll send the final icon files to Chen by Friday.
Chen: Then I'll submit the App Store listing by Monday.
Rina: Jake, make sure App Store review is submitted no later than next Wednesday — we need the buffer.
Jake: Understood. I'll submit to App Store review by Wednesday.
Rina: I'll send the launch announcement to the press list on launch day, two Mondays from now.
""",
        "reference_items": [
            {"task": "Fix three remaining P2 bugs", "owner": "Jake", "deadline": "Monday"},
            {"task": "Submit build 4.2.1 to TestFlight", "owner": "Jake", "deadline": "Sunday night"},
            {"task": "Complete regression testing", "owner": "Mel", "deadline": "Wednesday"},
            {"task": "Send final app icon files to marketing", "owner": "Ava", "deadline": "Friday"},
            {"task": "Submit App Store listing", "owner": "Chen", "deadline": "Monday"},
            {"task": "Submit app to App Store review", "owner": "Jake", "deadline": "next Wednesday"},
            {"task": "Send launch press announcement", "owner": "Rina", "deadline": "launch day (2 Mondays)"},
        ],
    },
    {
        "id": "T10",
        "scenario": "Cross-team dependency planning — platform and product",
        "transcript": """
Platform Lead (Grace): Product needs three new platform APIs for the dashboard redesign. We need to scope these.
Product (Ben): The three are: user preferences API, bulk export API, and webhook subscriptions. The dashboard redesign ships in six weeks.
Grace: User preferences is easy — two days. I can have it done by next Tuesday.
Ben: Webhook subscriptions is our top priority — can you do that first?
Grace: Webhooks is a two-week effort. I'll start today and target completion by the 22nd.
Ben: Bulk export can slip to week five — just needs to be done before go-live.
Grace: I'll start bulk export on the 23rd. Should be done by the 29th.
Ben: I need API documentation for all three before my team can integrate. Can you document as you go?
Grace: I'll publish docs to the developer portal within two days of each API being complete.
Ben: I'll set up integration test environments for my team by end of this week.
""",
        "reference_items": [
            {"task": "Build user preferences API", "owner": "Grace", "deadline": "next Tuesday"},
            {"task": "Build webhook subscriptions API", "owner": "Grace", "deadline": "the 22nd"},
            {"task": "Build bulk export API", "owner": "Grace", "deadline": "the 29th"},
            {"task": "Publish API documentation to developer portal", "owner": "Grace", "deadline": "within 2 days of each API"},
            {"task": "Set up integration test environments", "owner": "Ben", "deadline": "end of this week"},
        ],
    },
    {
        "id": "T11",
        "scenario": "Annual performance review prep",
        "transcript": """
HR (Sandra): Q4 performance reviews start in three weeks. Let me walk through the process.
Manager (Leo): When are self-assessments due?
Sandra: All employees must submit self-assessments by the 10th. Managers, you'll get two weeks after that to complete reviews.
Leo: So manager reviews due the 24th?
Sandra: Correct. HR will calibrate the following week and communicate outcomes by the 1st of next month.
Leo: I'll remind my team about the self-assessment deadline this week.
Sandra: Please do. Also, I need all managers to complete unconscious bias training before submitting reviews. It's a two-hour online module.
Leo: I'll complete it by this Friday. I'll also make sure my team members know the process.
Sandra: Natalie, can you update the performance review portal with this year's competency rubrics by Monday?
Natalie (HR Systems): I'll have it updated by Monday morning.
""",
        "reference_items": [
            {"task": "Submit self-assessment", "owner": "all employees", "deadline": "the 10th"},
            {"task": "Complete manager performance reviews", "owner": "managers", "deadline": "the 24th"},
            {"task": "Calibrate reviews and communicate outcomes", "owner": "HR", "deadline": "1st of next month"},
            {"task": "Remind team about self-assessment deadline", "owner": "Leo", "deadline": "this week"},
            {"task": "Complete unconscious bias training", "owner": "Leo", "deadline": "this Friday"},
            {"task": "Update performance review portal with competency rubrics", "owner": "Natalie", "deadline": "Monday morning"},
        ],
    },
    {
        "id": "T12",
        "scenario": "Infrastructure cost optimization meeting",
        "transcript": """
CTO (Farida): Cloud spend is up 35% YoY. We need to cut at least $200K this quarter.
DevOps (Riku): Biggest win is right-sizing EC2 instances. I've identified 40 over-provisioned instances. I can resize them by next Friday.
Farida: Do it. What's the savings estimate?
Riku: Around $80K annually. Second win is deleting orphaned snapshots and unused volumes — another $30K. I can do that this week.
Data (Nora): Our S3 storage costs are high because we're not using Intelligent-Tiering. I'll enable it on the analytics buckets by Wednesday.
Farida: Good. Riku, can you also set up a Cost Explorer dashboard so we track spend weekly?
Riku: I'll have the dashboard ready by Thursday.
Farida: Nora, review the data retention policies and flag any data we can archive or delete.
Nora: I'll have a retention policy review ready by next Monday.
Farida: I'll present the savings plan to the board next Thursday. I'll need a summary from both of you by Wednesday.
""",
        "reference_items": [
            {"task": "Resize 40 over-provisioned EC2 instances", "owner": "Riku", "deadline": "next Friday"},
            {"task": "Delete orphaned snapshots and unused volumes", "owner": "Riku", "deadline": "this week"},
            {"task": "Enable S3 Intelligent-Tiering on analytics buckets", "owner": "Nora", "deadline": "Wednesday"},
            {"task": "Set up AWS Cost Explorer dashboard for weekly tracking", "owner": "Riku", "deadline": "Thursday"},
            {"task": "Review data retention policies and flag archivable data", "owner": "Nora", "deadline": "next Monday"},
            {"task": "Submit cost savings summary for board presentation", "owner": "Riku and Nora", "deadline": "Wednesday"},
            {"task": "Present savings plan to board", "owner": "Farida", "deadline": "next Thursday"},
        ],
    },
    {
        "id": "T13",
        "scenario": "Post-launch retrospective — feature team",
        "transcript": """
EM (Chris): We launched the new checkout flow two weeks ago. Let's do the retro.
FE Lead (Pia): Conversion improved 8% but we had three production bugs in the first 48 hours.
Chris: What were the root causes?
Pia: Two were edge cases we didn't test — cart with 0 items, cart with gift card only. The third was a third-party payment timeout we didn't handle.
Chris: Pia, add those edge cases to the QA checklist for future releases.
Pia: I'll update the checklist by tomorrow.
BE Lead (Sam): The payment timeout issue — I'll add a graceful fallback and retry mechanism. Should be done by Thursday.
Chris: Good. Let's also do a load test before the next major release. Sam, schedule that for the staging env.
Sam: I'll set up and run the load test by end of next week.
Chris: I'll update our release process doc to require load testing as a gate. I'll do that by Friday.
Pia: I'll send the retrospective summary to the broader team by EOD today.
""",
        "reference_items": [
            {"task": "Add edge cases (empty cart, gift card only) to QA checklist", "owner": "Pia", "deadline": "tomorrow"},
            {"task": "Add graceful fallback and retry for payment timeouts", "owner": "Sam", "deadline": "Thursday"},
            {"task": "Set up and run load test in staging environment", "owner": "Sam", "deadline": "end of next week"},
            {"task": "Update release process doc to require load testing gate", "owner": "Chris", "deadline": "Friday"},
            {"task": "Send retrospective summary to broader team", "owner": "Pia", "deadline": "EOD today"},
        ],
    },
    {
        "id": "T14",
        "scenario": "Partnership kickoff — integration project",
        "transcript": """
Biz Dev (Lena): We're kicking off the Stripe integration project with the marketplace team. Go-live is in eight weeks.
Marketplace PM (Aaron): We've reviewed the Stripe API docs. The main work is webhooks for payment events and payout reports.
Eng (Kira): I'll start with the webhook listener service. Should be functional in two weeks — done by the 18th.
Aaron: Good. I need a sandbox test environment set up so my team can start integration testing.
Kira: I'll have the sandbox ready by end of this week.
Lena: Aaron, please share the test card numbers and Stripe test keys with Kira today.
Aaron: Sending them right after this call.
Kira: I'll need the payout report schema from Stripe — Aaron, can you get that from their partner portal?
Aaron: I'll get it today and share by tomorrow.
Lena: I'll schedule weekly syncs on Fridays. First one this Friday at 2pm. Everyone send me your availability conflicts by tomorrow noon.
""",
        "reference_items": [
            {"task": "Build webhook listener service for Stripe payment events", "owner": "Kira", "deadline": "the 18th"},
            {"task": "Set up Stripe sandbox test environment", "owner": "Kira", "deadline": "end of this week"},
            {"task": "Share Stripe test card numbers and test API keys", "owner": "Aaron", "deadline": "today"},
            {"task": "Get payout report schema from Stripe partner portal", "owner": "Aaron", "deadline": "today"},
            {"task": "Share payout report schema with Kira", "owner": "Aaron", "deadline": "tomorrow"},
            {"task": "Send availability conflicts for weekly syncs", "owner": "everyone", "deadline": "tomorrow noon"},
            {"task": "Schedule weekly Friday syncs", "owner": "Lena", "deadline": "this Friday 2pm"},
        ],
    },
    {
        "id": "T15",
        "scenario": "Compliance and audit preparation",
        "transcript": """
Compliance Lead (Isabel): Our SOC 2 Type II audit starts in six weeks. We need to close all open gaps.
Eng (Viktor): The biggest gap is audit logging — we're missing event logs for admin panel actions.
Isabel: Viktor, implement comprehensive audit logging for the admin panel by two weeks from now.
Viktor: I'll have it done by the 20th.
Isabel: We also need evidence of our encryption at rest. Victor, can you document the encryption config for all databases?
Viktor: I'll document it by next Friday.
Security (Mei): We still have 12 employees who haven't completed security awareness training.
Isabel: Mei, send reminders to those 12 employees today and escalate to their managers if not done by Friday.
Mei: Will do.
Isabel: I need all department heads to review and re-sign the information security policy by next Wednesday.
Ops (Jordan): I'll circulate the policy to all department heads today with a signature deadline of Wednesday.
Isabel: Good. I'll run a mock audit walkthrough with the team two weeks before the real audit — put that on the calendar for the 28th.
""",
        "reference_items": [
            {"task": "Implement audit logging for admin panel actions", "owner": "Viktor", "deadline": "the 20th"},
            {"task": "Document encryption at rest configuration for all databases", "owner": "Viktor", "deadline": "next Friday"},
            {"task": "Send security awareness training reminders to 12 employees", "owner": "Mei", "deadline": "today"},
            {"task": "Escalate training non-completion to managers", "owner": "Mei", "deadline": "Friday"},
            {"task": "Circulate information security policy for re-signing", "owner": "Jordan", "deadline": "today"},
            {"task": "Department heads re-sign information security policy", "owner": "department heads", "deadline": "next Wednesday"},
            {"task": "Schedule mock audit walkthrough", "owner": "Isabel", "deadline": "the 28th"},
        ],
    },
    {
        "id": "T16",
        "scenario": "Team OKR setting — Q4",
        "transcript": """
Director (Pradeep): Let's finalize our Q4 OKRs. We have three key results to nail down.
PM (Sara): KR1 is launching the analytics dashboard. I'll write the full spec and share with engineering by tomorrow.
Eng Lead (Tomas): I'll estimate the engineering effort by end of week and report back.
Pradeep: KR2 is reducing customer churn by 5%. Support, what do you need?
Support Lead (Zoe): I need the churn analysis data from data science by Monday so I can plan interventions.
Data Sci (Ray): I'll run the churn analysis and send Zoe the report by Monday morning.
Pradeep: KR3 is hitting 99.9% uptime. Tomas, what do we need?
Tomas: We need to complete the failover setup for the database cluster. I'll scope that by Thursday.
Pradeep: Great. Everyone submit your updated OKRs in the tracking system by Friday EOD. I'll review and finalize by Monday.
""",
        "reference_items": [
            {"task": "Write analytics dashboard full spec", "owner": "Sara", "deadline": "tomorrow"},
            {"task": "Estimate engineering effort for analytics dashboard", "owner": "Tomas", "deadline": "end of week"},
            {"task": "Run churn analysis and send report to Zoe", "owner": "Ray", "deadline": "Monday morning"},
            {"task": "Scope database cluster failover setup", "owner": "Tomas", "deadline": "Thursday"},
            {"task": "Submit updated OKRs to tracking system", "owner": "everyone", "deadline": "Friday EOD"},
            {"task": "Review and finalize Q4 OKRs", "owner": "Pradeep", "deadline": "Monday"},
        ],
    },
    {
        "id": "T17",
        "scenario": "Marketing campaign planning",
        "transcript": """
CMO (Diana): We're launching the summer campaign in four weeks. Let's align on deliverables.
Content (Hugo): I need the campaign brief to start writing copy.
Diana: I'll send the brief today by 5pm, Hugo.
Hugo: Then I can have the first draft of copy for emails and landing page by next Wednesday.
Diana: Perfect. Design, what's your timeline for creative assets?
Design (Yara): I need the copy before I can finalize visuals. If I get Hugo's draft Wednesday, I can have final assets by the following Monday.
Diana: That works. Paid media, when do you need assets?
Paid Media (Eli): I need everything by the Monday Yara mentioned to set up campaign targeting and get it live.
Diana: Hugo, make sure you CC Eli on all drafts so he can plan ahead.
Hugo: Will do.
Eli: I'll set up the campaign structure in Google Ads and Meta by this Friday so we're ready to load assets.
Diana: I'll schedule the final creative review for next Thursday at 2pm. Everyone block it.
""",
        "reference_items": [
            {"task": "Send campaign brief to content team", "owner": "Diana", "deadline": "today 5pm"},
            {"task": "Write first draft of email and landing page copy", "owner": "Hugo", "deadline": "next Wednesday"},
            {"task": "Finalize creative visual assets", "owner": "Yara", "deadline": "Monday after next"},
            {"task": "Set up campaign structure in Google Ads and Meta", "owner": "Eli", "deadline": "this Friday"},
            {"task": "Load assets and launch paid campaign", "owner": "Eli", "deadline": "Monday Yara delivers"},
            {"task": "CC Eli on all copy drafts", "owner": "Hugo", "deadline": "ongoing"},
            {"task": "Schedule final creative review", "owner": "Diana", "deadline": "next Thursday 2pm"},
        ],
    },
    {
        "id": "T18",
        "scenario": "Bug triage — platform stability",
        "transcript": """
Eng Manager (Mo): We have seven open P1 bugs from the last release. Let's assign owners.
Dev (Ana): Bug 1042 — memory leak in the worker service — is mine. I'll have a fix by tomorrow.
Dev (Ben): Bug 1055 — API timeout under load — I'll investigate root cause today and have a fix by Thursday.
Dev (Cara): Bug 1061 — incorrect pagination on the search endpoint. I can fix it today, it's a one-liner.
Mo: Great. Bug 1078 — the file upload crash on large files. Who can take that?
Ana: I'll take 1078 too. It's related to the memory issue. I'll fix it alongside 1042 by tomorrow.
Mo: Good. Bugs 1081 and 1083 are UI glitches — those go to the frontend team. Tom, please assign them and have fixes by Friday.
Tom (FE Lead): I'll assign 1081 to Jade and 1083 to myself. Both fixed by Friday.
Mo: Bug 1090 — DB deadlock on concurrent writes. Ben, add that to your plate after 1055.
Ben: I can have 1090 fixed by next Monday.
Mo: QA, please verify all fixes in staging before we cherry-pick to production. Coordinate with each dev as fixes land.
""",
        "reference_items": [
            {"task": "Fix memory leak in worker service (bug 1042)", "owner": "Ana", "deadline": "tomorrow"},
            {"task": "Fix large file upload crash (bug 1078)", "owner": "Ana", "deadline": "tomorrow"},
            {"task": "Investigate and fix API timeout under load (bug 1055)", "owner": "Ben", "deadline": "Thursday"},
            {"task": "Fix incorrect pagination on search endpoint (bug 1061)", "owner": "Cara", "deadline": "today"},
            {"task": "Assign and fix UI glitch bug 1081", "owner": "Tom/Jade", "deadline": "Friday"},
            {"task": "Fix UI glitch bug 1083", "owner": "Tom", "deadline": "Friday"},
            {"task": "Fix DB deadlock on concurrent writes (bug 1090)", "owner": "Ben", "deadline": "next Monday"},
            {"task": "Verify all fixes in staging before cherry-pick", "owner": "QA", "deadline": "as fixes land"},
        ],
    },
    {
        "id": "T19",
        "scenario": "Investor update preparation",
        "transcript": """
CEO (Naomi): Board meeting is in two weeks. We need to prepare the investor deck and supporting materials.
CFO (Jorge): I'll prepare the financial slides — P&L, runway, and ARR growth — by next Wednesday.
Naomi: Include the cohort analysis this time, Jorge. Investors asked for it last quarter.
Jorge: I'll add cohort analysis. Still by Wednesday.
Head of Product (Kim): I'll prepare the product milestones and roadmap section by Tuesday, so Naomi has time to review.
Naomi: Good. I'll review everything by Thursday and send consolidated deck to the board by Friday.
Head of Sales (Derek): Do you want me to prepare the sales pipeline and win/loss slide?
Naomi: Yes please, Derek. By Monday — I want the full deck assembled by Tuesday at the latest.
Derek: I'll have the sales slide ready Monday morning.
Legal (Pam): Naomi, I'll prepare the cap table update by Tuesday — there were two new grants.
Naomi: Thanks Pam. I'll do a dry run of the presentation Thursday afternoon with the exec team.
""",
        "reference_items": [
            {"task": "Prepare financial slides (P&L, runway, ARR growth, cohort analysis)", "owner": "Jorge", "deadline": "next Wednesday"},
            {"task": "Prepare product milestones and roadmap section", "owner": "Kim", "deadline": "Tuesday"},
            {"task": "Prepare sales pipeline and win/loss slide", "owner": "Derek", "deadline": "Monday morning"},
            {"task": "Prepare cap table update with new grants", "owner": "Pam", "deadline": "Tuesday"},
            {"task": "Review all deck sections", "owner": "Naomi", "deadline": "Thursday"},
            {"task": "Send consolidated deck to board", "owner": "Naomi", "deadline": "Friday"},
            {"task": "Run presentation dry run with exec team", "owner": "Naomi", "deadline": "Thursday afternoon"},
        ],
    },
    {
        "id": "T20",
        "scenario": "ML model deployment review",
        "transcript": """
ML Lead (Aisha): We're deploying the new recommendation model next week. Let's finalize the rollout plan.
MLOps (Felix): The model is packaged and passing shadow mode tests. I'll deploy to 10% of traffic by Wednesday.
Aisha: Monitor for 48 hours and ramp to 50% by Friday if metrics look good.
Felix: Got it. I'll set up the A/B test framework and monitoring dashboards by Tuesday.
Data (Nadia): I'll prepare the offline evaluation report — AUC, NDCG, and coverage — by Monday so you have baseline numbers.
Aisha: Good. Felix, define the rollback criteria before deployment — what metrics trigger an automatic rollback?
Felix: I'll document rollback criteria and thresholds by Monday EOD and share with the team.
PM (Kevin): I need to notify the business teams when the model goes live. Felix, send me the deployment confirmation.
Felix: I'll ping you as soon as it's live on Wednesday.
Aisha: Kevin, prepare a one-pager summary of expected business impact for the business team by Thursday.
Kevin: I'll have it ready Thursday morning.
""",
        "reference_items": [
            {"task": "Prepare offline evaluation report (AUC, NDCG, coverage)", "owner": "Nadia", "deadline": "Monday"},
            {"task": "Document rollback criteria and thresholds", "owner": "Felix", "deadline": "Monday EOD"},
            {"task": "Set up A/B test framework and monitoring dashboards", "owner": "Felix", "deadline": "Tuesday"},
            {"task": "Deploy recommendation model to 10% traffic", "owner": "Felix", "deadline": "Wednesday"},
            {"task": "Send deployment confirmation to Kevin", "owner": "Felix", "deadline": "Wednesday"},
            {"task": "Ramp model to 50% traffic if metrics pass", "owner": "Felix", "deadline": "Friday"},
            {"task": "Prepare business impact one-pager", "owner": "Kevin", "deadline": "Thursday morning"},
        ],
    },
]

# ---------------------------------------------------------------------------
# Evaluation helpers
# ---------------------------------------------------------------------------

USER_PROMPT_TEMPLATE = (
    "Extract all action items from the following meeting transcript. "
    "For each action item, specify: the task description, the owner (person responsible), "
    "and the deadline.\n\nTranscript:\n{transcript}"
)


def call_model(
    endpoint: str,
    model: str,
    transcript: str,
    api_key: str = "EMPTY",
    system: str = SYSTEM_MEETING,
    max_tokens: int = 1024,
) -> tuple[str, float]:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": USER_PROMPT_TEMPLATE.format(transcript=transcript.strip())},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.0,
    }
    start = time.time()
    r = requests.post(f"{endpoint}/chat/completions", json=payload, headers=headers, timeout=180)
    r.raise_for_status()
    latency = time.time() - start
    return r.json()["choices"][0]["message"]["content"], round(latency, 2)


def _extract_names(text: str) -> set[str]:
    return {w for w in re.findall(r"\b[A-Z][a-z]+\b", text)}


def _extract_deadlines(text: str) -> set[str]:
    patterns = [
        r"\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
        r"\b(this week|next week|end of week|eow|eod|end of day)\b",
        r"\b(the \d{1,2}(?:st|nd|rd|th)?)\b",
        r"\b(\d{1,2}(?:st|nd|rd|th)?\s+of\s+\w+)\b",
        r"\b(by \w+ \d+)\b",
        r"\b(next \w+day)\b",
    ]
    found = set()
    lower = text.lower()
    for p in patterns:
        found.update(re.findall(p, lower))
    return found


def evaluate_item_level_f1(
    prediction: str, reference_items: list[dict]
) -> dict[str, float]:
    """
    Fuzzy item-level F1: a predicted item is a TP if its ROUGE-L vs any reference item >= 0.5.
    Precision = TPs / predicted_count; Recall = TPs / reference_count.
    """
    # Split prediction into lines, filter blank/header lines
    pred_lines = [
        ln.strip().lstrip("0123456789.-) ").strip()
        for ln in prediction.splitlines()
        if len(ln.strip()) > 10
    ]
    if not pred_lines:
        return {"item_precision": 0.0, "item_recall": 0.0, "item_f1": 0.0}

    ref_texts = [f"{it['task']} {it.get('owner','')} {it.get('deadline','')}" for it in reference_items]
    matched_refs = set()
    tp = 0

    for pred_line in pred_lines:
        best_score = 0.0
        best_ref = -1
        for j, ref in enumerate(ref_texts):
            sc = rouge_single_prf(pred_line, ref)["rougeL_f1"]
            if sc > best_score:
                best_score = sc
                best_ref = j
        if best_score >= 50.0 and best_ref not in matched_refs:
            tp += 1
            matched_refs.add(best_ref)

    precision = tp / max(1, len(pred_lines))
    recall = tp / max(1, len(ref_texts))
    f1 = 2 * precision * recall / (precision + recall) if precision + recall > 0 else 0.0
    return {
        "item_precision": round(precision, 4),
        "item_recall": round(recall, 4),
        "item_f1": round(f1, 4),
    }


def evaluate_owner_coverage(prediction: str, reference_items: list[dict]) -> float:
    """Fraction of reference owners (first names) that appear in the prediction."""
    pred_lower = prediction.lower()
    owners = [it.get("owner", "").split()[0].lower() for it in reference_items if it.get("owner")]
    owners = [o for o in owners if len(o) > 2 and o not in ("all", "the", "each", "every")]
    if not owners:
        return 1.0
    found = sum(1 for o in owners if o in pred_lower)
    return round(found / len(owners), 4)


def evaluate_deadline_coverage(prediction: str, reference_items: list[dict]) -> float:
    """Fraction of reference deadlines whose key terms appear in the prediction."""
    pred_lower = prediction.lower()
    deadlines = [it.get("deadline", "").lower() for it in reference_items if it.get("deadline")]
    if not deadlines:
        return 1.0
    found = 0
    for dl in deadlines:
        keywords = [w for w in dl.split() if len(w) > 2 and w not in ("the", "end", "day", "week")]
        if keywords and any(kw in pred_lower for kw in keywords):
            found += 1
    return round(found / len(deadlines), 4)


def evaluate_model(
    endpoint: str,
    model: str,
    api_key: str,
    system: str,
    transcripts: list[dict],
) -> dict:
    sample_results = []
    for t in transcripts:
        try:
            prediction, latency = call_model(endpoint, model, t["transcript"], api_key, system)
        except Exception as e:
            prediction, latency = "", 0.0
            print(f"  {t['id']}: ERROR — {e}")

        ref_items = t["reference_items"]
        ref_text = " ".join(
            f"{it['task']} {it.get('owner','')} {it.get('deadline','')}"
            for it in ref_items
        )
        rouge = rouge_single_prf(prediction, ref_text)
        item_f1 = evaluate_item_level_f1(prediction, ref_items)
        owner_cov = evaluate_owner_coverage(prediction, ref_items)
        deadline_cov = evaluate_deadline_coverage(prediction, ref_items)

        result = {
            "id": t["id"],
            "scenario": t["scenario"],
            "latency": latency,
            "rouge1_f1": rouge["rouge1_f1"],
            "rouge1_precision": rouge["rouge1_precision"],
            "rouge1_recall": rouge["rouge1_recall"],
            "rougeL_f1": rouge["rougeL_f1"],
            **item_f1,
            "owner_coverage": owner_cov,
            "deadline_coverage": deadline_cov,
            "num_reference_items": len(ref_items),
        }
        sample_results.append(result)
        print(
            f"  {t['id']}: item_f1={item_f1['item_f1']:.2f}  owner_cov={owner_cov:.2f}  "
            f"deadline_cov={deadline_cov:.2f}  ({latency:.1f}s)"
        )

    def avg(key: str) -> float:
        vals = [r[key] for r in sample_results]
        return round(sum(vals) / len(vals), 4) if vals else 0.0

    return {
        "model": model,
        "benchmark": "action_items",
        "num_transcripts": len(sample_results),
        "avg_rouge1_f1": avg("rouge1_f1"),
        "avg_rouge1_precision": avg("rouge1_precision"),
        "avg_rouge1_recall": avg("rouge1_recall"),
        "avg_rougeL_f1": avg("rougeL_f1"),
        "avg_item_precision": avg("item_precision"),
        "avg_item_recall": avg("item_recall"),
        "avg_item_f1": avg("item_f1"),
        "avg_owner_coverage": avg("owner_coverage"),
        "avg_deadline_coverage": avg("deadline_coverage"),
        "avg_latency_sec": avg("latency"),
        "details": sample_results,
    }


def main():
    ap = argparse.ArgumentParser(description="Action item extraction evaluation")
    ap.add_argument("--config", default=None, help="models_config.json path (runs all models)")
    ap.add_argument("--endpoint", default=None, help="Single model endpoint URL")
    ap.add_argument("--model", default=None)
    ap.add_argument("--api_key", default="EMPTY")
    ap.add_argument("--model-types", default="meeting,main,baseline",
                    help="Comma-separated model types to evaluate from config")
    ap.add_argument("--out-dir", default=".", help="Directory to write results JSON files")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    default_key = os.environ.get("RUNPOD_API_KEY") or os.environ.get("RUNPOD_KEY") or ""

    def _slug(s: str) -> str:
        return re.sub(r"[^a-zA-Z0-9._-]+", "_", s)[:80]

    if args.endpoint and args.model:
        system = SYSTEM_MAIN if "main" in args.model.lower() else SYSTEM_MEETING
        print(f"\nEvaluating: {args.model}\nEndpoint:   {args.endpoint}\n")
        result = evaluate_model(args.endpoint, args.model, args.api_key, system, TRANSCRIPTS)
        out_file = out_dir / f"action_items_{_slug(args.model)}.json"
        out_file.write_text(json.dumps(result, indent=2))
        print(f"\nSaved: {out_file}")
        print(f"  avg_item_f1:         {result['avg_item_f1']}")
        print(f"  avg_owner_coverage:  {result['avg_owner_coverage']}")
        print(f"  avg_deadline_coverage: {result['avg_deadline_coverage']}")
        return

    if not args.config:
        ap.error("Provide --config or --endpoint + --model")

    cfg = json.loads(Path(args.config).read_text())
    allowed_types = {t.strip() for t in args.model_types.split(",")}
    models = [
        m for m in cfg.get("models", [])
        if "YOUR_" not in m.get("endpoint", "")
        and m.get("type", "") in allowed_types
    ]
    if not models:
        print("No eligible models in config (check endpoint URLs and model types).")
        return

    for m in models:
        label = m.get("label", m["model_id"])
        mtype = m.get("type", "meeting")
        endpoint = m["endpoint"].rstrip("/")
        model_id = m["model_id"]
        api_key = m.get("api_key") or default_key or "EMPTY"
        system = SYSTEM_MAIN if mtype == "main" else SYSTEM_MEETING

        print(f"\n{'='*60}")
        print(f"Model:    {label}")
        print(f"Endpoint: {endpoint}")
        print(f"{'='*60}")

        result = evaluate_model(endpoint, model_id, api_key, system, TRANSCRIPTS)
        out_file = out_dir / f"action_items_{_slug(model_id)}.json"
        out_file.write_text(json.dumps(result, indent=2))
        print(f"\nSaved: {out_file}")
        print(f"  avg_item_f1:           {result['avg_item_f1']}")
        print(f"  avg_owner_coverage:    {result['avg_owner_coverage']}")
        print(f"  avg_deadline_coverage: {result['avg_deadline_coverage']}")


if __name__ == "__main__":
    main()
