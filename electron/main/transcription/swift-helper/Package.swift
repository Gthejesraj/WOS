// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "wos-transcribe",
  platforms: [.macOS(.v26)],
  targets: [
    .executableTarget(
      name: "wos-transcribe",
      path: ".",
      sources: ["wos-transcribe.swift"]
    )
  ]
)
