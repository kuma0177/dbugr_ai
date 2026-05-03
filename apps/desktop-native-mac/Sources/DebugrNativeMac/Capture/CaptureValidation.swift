import CoreGraphics
import Foundation

enum CaptureValidation {
    static func validate(_ image: CGImage) -> CaptureValidationResult {
        let width = image.width
        let height = image.height
        var issues: [String] = []

        if width <= 0 || height <= 0 {
            issues.append("image has zero dimensions")
            return CaptureValidationResult(
                isValid: false,
                width: width,
                height: height,
                transparentSampleRatio: 1,
                dominantColorRatio: 1,
                sampledPixels: 0,
                issues: issues
            )
        }

        let sample = samplePixels(image)
        if sample.count == 0 {
            issues.append("could not sample pixels")
        }

        let transparentCount = sample.filter { $0.alpha < 8 }.count
        let transparentRatio = sample.isEmpty ? 1 : Double(transparentCount) / Double(sample.count)

        var buckets: [PixelBucket: Int] = [:]
        for pixel in sample {
            buckets[pixel.bucket, default: 0] += 1
        }
        let dominantCount = buckets.values.max() ?? 0
        let dominantRatio = sample.isEmpty ? 1 : Double(dominantCount) / Double(sample.count)

        if transparentRatio > 0.98 {
            issues.append("sample is almost fully transparent")
        }
        if dominantRatio > 0.995 {
            issues.append("sample is overwhelmingly one color")
        }
        if width < 32 || height < 32 {
            issues.append("image is suspiciously small")
        }

        return CaptureValidationResult(
            isValid: issues.isEmpty,
            width: width,
            height: height,
            transparentSampleRatio: transparentRatio,
            dominantColorRatio: dominantRatio,
            sampledPixels: sample.count,
            issues: issues
        )
    }

    private static func samplePixels(_ image: CGImage) -> [SampledPixel] {
        let targetWidth = min(80, max(1, image.width))
        let targetHeight = min(80, max(1, image.height))
        let bytesPerPixel = 4
        let bytesPerRow = targetWidth * bytesPerPixel
        var data = [UInt8](repeating: 0, count: targetHeight * bytesPerRow)

        guard let context = CGContext(
            data: &data,
            width: targetWidth,
            height: targetHeight,
            bitsPerComponent: 8,
            bytesPerRow: bytesPerRow,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            return []
        }

        context.interpolationQuality = .low
        context.draw(image, in: CGRect(x: 0, y: 0, width: targetWidth, height: targetHeight))

        var pixels: [SampledPixel] = []
        pixels.reserveCapacity(targetWidth * targetHeight)
        for offset in stride(from: 0, to: data.count, by: bytesPerPixel) {
            pixels.append(SampledPixel(red: data[offset], green: data[offset + 1], blue: data[offset + 2], alpha: data[offset + 3]))
        }
        return pixels
    }
}

private struct SampledPixel {
    let red: UInt8
    let green: UInt8
    let blue: UInt8
    let alpha: UInt8

    var bucket: PixelBucket {
        PixelBucket(red: red / 16, green: green / 16, blue: blue / 16, alpha: alpha / 16)
    }
}

private struct PixelBucket: Hashable {
    let red: UInt8
    let green: UInt8
    let blue: UInt8
    let alpha: UInt8
}
