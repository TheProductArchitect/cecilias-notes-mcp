// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "cecilias-notes-multipeer",
    platforms: [
        .macOS(.v13)
    ],
    targets: [
        .executableTarget(
            name: "cecilias-notes-multipeer",
            path: "Sources/CeciliasNotesMultipeer"
        )
    ]
)
