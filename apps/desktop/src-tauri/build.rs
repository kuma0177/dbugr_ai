fn main() {
    // Embed Info.plist into the binary so macOS TCC uses CFBundleIdentifier
    // as the stable permission identity rather than a hash of the binary content.
    // Without this, every rebuild gets a new hash-based identity and loses TCC grants.
    #[cfg(target_os = "macos")]
    {
        let plist = concat!(env!("CARGO_MANIFEST_DIR"), "/Info.plist");
        println!("cargo:rustc-link-arg=-sectcreate");
        println!("cargo:rustc-link-arg=__TEXT");
        println!("cargo:rustc-link-arg=__info_plist");
        println!("cargo:rustc-link-arg={plist}");
    }
    tauri_build::build()
}
