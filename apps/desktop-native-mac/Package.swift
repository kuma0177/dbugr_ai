// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "DebugrNativeMac",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "debugr-native-mac", targets: ["DebugrNativeMac"])
    ],
    targets: [
        .executableTarget(
            name: "DebugrNativeMac",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("Carbon"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("ScreenCaptureKit")
            ]
        )
    ]
)
