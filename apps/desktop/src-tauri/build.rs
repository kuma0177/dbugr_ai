fn main() {
    // Embed Info.plist into the binary so macOS TCC uses CFBundleIdentifier
    // as the stable permission identity rather than a hash of the binary content.
    // Without this, every rebuild gets a new hash-based identity and loses TCC grants.
    #[cfg(target_os = "macos")]
    {
        cc::Build::new()
            .file("src/macos_screencapturekit.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("debugr_screencapturekit");
        println!("cargo:rustc-link-lib=framework=ScreenCaptureKit");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=CoreGraphics");

        let plist = concat!(env!("CARGO_MANIFEST_DIR"), "/Info.plist");
        println!("cargo:rustc-link-arg=-sectcreate");
        println!("cargo:rustc-link-arg=__TEXT");
        println!("cargo:rustc-link-arg=__info_plist");
        println!("cargo:rustc-link-arg={plist}");
        println!("cargo:rerun-if-changed=src/macos_screencapturekit.m");
    }
    tauri_build::build()
}
