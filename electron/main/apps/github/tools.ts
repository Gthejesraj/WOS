import type { Tool } from '../../tools'
import * as api from './api'

export function buildGitHubTools(creds: { token: string }): Tool[] {
  const { token } = creds
  return [
    {
      name: 'GitHubListRepos',
      description: 'List GitHub repositories for the authenticated user.',
      readOnly: true,
      inputSchema: {
        type: 'object',
        properties: {
          visibility: { type: 'string', enum: ['all', 'public', 'private'], description: 'Filter by visibility' },
          sort: { type: 'string', enum: ['created', 'updated', 'pushed', 'full_name'], description: 'Sort field' },
          per_page: { type: 'number', description: 'Results per page (max 100)' },
          page: { type: 'number', description: 'Page number' },
        },
      },
      async execute(input) {
        const p = input as { visibility?: string; sort?: string; per_page?: number; page?: number }
        const repos = await api.listRepos(token, p)
        return { output: JSON.stringify(repos, null, 2) }
      },
    },
    {
      name: 'GitHubGetRepo',
      description: 'Get details about a specific GitHub repository.',
      readOnly: true,
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo'],
        properties: {
          owner: { type: 'string', description: 'Repository owner (username or org)' },
          repo: { type: 'string', description: 'Repository name' },
        },
      },
      async execute(input) {
        const { owner, repo } = input as { owner: string; repo: string }
        const data = await api.getRepo(token, owner, repo)
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'GitHubCreateRepo',
      description: 'Create a new GitHub repository.',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Repository name' },
          description: { type: 'string', description: 'Repository description' },
          private: { type: 'boolean', description: 'Make the repo private (default: false)' },
          auto_init: { type: 'boolean', description: 'Initialize with README' },
        },
      },
      async execute(input) {
        const data = await api.createRepo(token, input as { name: string; private?: boolean; description?: string; auto_init?: boolean })
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'GitHubListBranches',
      description: 'List branches in a GitHub repository.',
      readOnly: true,
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo'],
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
        },
      },
      async execute(input) {
        const { owner, repo } = input as { owner: string; repo: string }
        const data = await api.listBranches(token, owner, repo)
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'GitHubCreateBranch',
      description: 'Create a new branch in a GitHub repository from a given commit SHA.',
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo', 'branch_name', 'from_sha'],
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          branch_name: { type: 'string', description: 'Name for the new branch' },
          from_sha: { type: 'string', description: 'Commit SHA to branch from' },
        },
      },
      async execute(input) {
        const { owner, repo, branch_name, from_sha } = input as { owner: string; repo: string; branch_name: string; from_sha: string }
        const data = await api.createBranch(token, owner, repo, branch_name, from_sha)
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'GitHubListIssues',
      description: 'List issues in a GitHub repository.',
      readOnly: true,
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo'],
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Issue state (default: open)' },
          labels: { type: 'string', description: 'Comma-separated label names to filter by' },
          assignee: { type: 'string', description: 'Filter by assignee username' },
          per_page: { type: 'number' },
          page: { type: 'number' },
        },
      },
      async execute(input) {
        const { owner, repo, ...params } = input as { owner: string; repo: string; state?: string; labels?: string; assignee?: string; per_page?: number; page?: number }
        const data = await api.listIssues(token, owner, repo, params)
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'GitHubGetIssue',
      description: 'Get a specific GitHub issue with its comments.',
      readOnly: true,
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo', 'issue_number'],
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          issue_number: { type: 'number', description: 'Issue number' },
        },
      },
      async execute(input) {
        const { owner, repo, issue_number } = input as { owner: string; repo: string; issue_number: number }
        const data = await api.getIssue(token, owner, repo, issue_number)
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'GitHubCreateIssue',
      description: 'Create a new issue in a GitHub repository.',
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo', 'title'],
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          title: { type: 'string', description: 'Issue title' },
          body: { type: 'string', description: 'Issue body (markdown)' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Label names' },
          assignees: { type: 'array', items: { type: 'string' }, description: 'Usernames to assign' },
        },
      },
      async execute(input) {
        const { owner, repo, ...body } = input as { owner: string; repo: string; title: string; body?: string; labels?: string[]; assignees?: string[] }
        const data = await api.createIssue(token, owner, repo, body)
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'GitHubUpdateIssue',
      description: 'Update a GitHub issue (title, body, state, labels).',
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo', 'issue_number'],
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          issue_number: { type: 'number' },
          title: { type: 'string' },
          body: { type: 'string' },
          state: { type: 'string', enum: ['open', 'closed'] },
          labels: { type: 'array', items: { type: 'string' } },
        },
      },
      async execute(input) {
        const { owner, repo, issue_number, ...body } = input as { owner: string; repo: string; issue_number: number; title?: string; body?: string; state?: string; labels?: string[] }
        const data = await api.updateIssue(token, owner, repo, issue_number, body)
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'GitHubAddIssueComment',
      description: 'Add a comment to a GitHub issue or pull request.',
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo', 'issue_number', 'comment'],
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          issue_number: { type: 'number' },
          comment: { type: 'string', description: 'Comment body (markdown)' },
        },
      },
      async execute(input) {
        const { owner, repo, issue_number, comment } = input as { owner: string; repo: string; issue_number: number; comment: string }
        const data = await api.addIssueComment(token, owner, repo, issue_number, comment)
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'GitHubListPRs',
      description: 'List pull requests in a GitHub repository.',
      readOnly: true,
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo'],
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          state: { type: 'string', enum: ['open', 'closed', 'all'] },
          per_page: { type: 'number' },
          page: { type: 'number' },
        },
      },
      async execute(input) {
        const { owner, repo, ...params } = input as { owner: string; repo: string; state?: string; per_page?: number; page?: number }
        const data = await api.listPRs(token, owner, repo, params)
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'GitHubGetPR',
      description: 'Get a specific GitHub pull request with review status.',
      readOnly: true,
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo', 'pr_number'],
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          pr_number: { type: 'number' },
        },
      },
      async execute(input) {
        const { owner, repo, pr_number } = input as { owner: string; repo: string; pr_number: number }
        const data = await api.getPR(token, owner, repo, pr_number)
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'GitHubCreatePR',
      description: 'Create a pull request on GitHub.',
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo', 'title', 'head', 'base'],
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          title: { type: 'string' },
          head: { type: 'string', description: 'Branch with changes (e.g. feature/my-branch)' },
          base: { type: 'string', description: 'Branch to merge into (e.g. main)' },
          body: { type: 'string', description: 'PR description (markdown)' },
          draft: { type: 'boolean' },
        },
      },
      async execute(input) {
        const { owner, repo, ...body } = input as { owner: string; repo: string; title: string; head: string; base: string; body?: string; draft?: boolean }
        const data = await api.createPR(token, owner, repo, body)
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'GitHubGetFileContent',
      description: 'Read the content of a file from a GitHub repository.',
      readOnly: true,
      inputSchema: {
        type: 'object',
        required: ['owner', 'repo', 'path'],
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          path: { type: 'string', description: 'File path within the repo' },
          ref: { type: 'string', description: 'Branch, tag, or commit SHA (default: default branch)' },
        },
      },
      async execute(input) {
        const { owner, repo, path, ref } = input as { owner: string; repo: string; path: string; ref?: string }
        const data = await api.getFileContent(token, owner, repo, path, ref)
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'GitHubSearchCode',
      description: 'Search code across GitHub repositories using the code search API.',
      readOnly: true,
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Search query (e.g. "useState repo:owner/repo language:typescript")' },
          per_page: { type: 'number', description: 'Results per page (max 30 for code search)' },
        },
      },
      async execute(input) {
        const { query, per_page } = input as { query: string; per_page?: number }
        const data = await api.searchCode(token, query, per_page)
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'GitHubListNotifications',
      description: 'List GitHub notifications for the authenticated user.',
      readOnly: true,
      inputSchema: {
        type: 'object',
        properties: {
          all: { type: 'boolean', description: 'Include read notifications (default: false = unread only)' },
        },
      },
      async execute(input) {
        const { all } = (input ?? {}) as { all?: boolean }
        const data = await api.listNotifications(token, all)
        return { output: JSON.stringify(data, null, 2) }
      },
    },
    {
      name: 'GitHubMarkNotificationsRead',
      description: 'Mark all GitHub notifications as read.',
      inputSchema: { type: 'object', properties: {} },
      async execute() {
        await api.markNotificationsRead(token)
        return { output: 'All notifications marked as read.' }
      },
    },
  ]
}
