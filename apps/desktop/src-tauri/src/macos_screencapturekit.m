#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <dispatch/dispatch.h>
#import <math.h>
#import <stdbool.h>
#import <stdint.h>
#import <stdlib.h>
#import <string.h>

static char *debugr_copy_utf8(NSString *value) {
    if (value == nil) {
        return NULL;
    }
    const char *utf8 = value.UTF8String;
    if (utf8 == NULL) {
        return NULL;
    }
    size_t len = strlen(utf8);
    char *copy = malloc(len + 1);
    if (copy == NULL) {
        return NULL;
    }
    memcpy(copy, utf8, len + 1);
    return copy;
}

static NSError *debugr_make_error(NSString *message) {
    return [NSError errorWithDomain:@"ai.debugr.screencapturekit"
                               code:1
                           userInfo:@{NSLocalizedDescriptionKey: message ?: @"Unknown ScreenCaptureKit error"}];
}

static NSData *debugr_png_data_from_image(CGImageRef image) {
    if (image == NULL) {
        return nil;
    }
    NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithCGImage:image];
    if (bitmap == nil) {
        return nil;
    }
    return [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
}

static void debugr_capture_with_filter(
    CGRect globalRectPoints,
    void (^completion)(CGImageRef _Nullable image, NSError *_Nullable error)
) API_AVAILABLE(macos(14.0)) {
    [SCShareableContent getShareableContentWithCompletionHandler:^(
        SCShareableContent * _Nullable shareableContent,
        NSError * _Nullable shareableError
    ) {
        if (shareableError != nil) {
            completion(NULL, shareableError);
            return;
        }
        if (shareableContent == nil || shareableContent.displays.count == 0) {
            completion(NULL, debugr_make_error(@"No shareable displays were available for capture."));
            return;
        }

        CGPoint center = CGPointMake(CGRectGetMidX(globalRectPoints), CGRectGetMidY(globalRectPoints));
        SCDisplay *matchedDisplay = nil;
        for (SCDisplay *display in shareableContent.displays) {
            if (CGRectContainsPoint(display.frame, center) || CGRectIntersectsRect(display.frame, globalRectPoints)) {
                matchedDisplay = display;
                break;
            }
        }
        if (matchedDisplay == nil) {
            matchedDisplay = shareableContent.displays.firstObject;
        }
        if (matchedDisplay == nil) {
            completion(NULL, debugr_make_error(@"Unable to match the capture region to a display."));
            return;
        }

        CGRect displayFrame = matchedDisplay.frame;
        if (CGRectGetWidth(displayFrame) <= 0.0 || CGRectGetHeight(displayFrame) <= 0.0) {
            completion(NULL, debugr_make_error(@"The selected display reported an invalid frame."));
            return;
        }

        CGFloat scaleX = (CGFloat)CGDisplayPixelsWide(matchedDisplay.displayID) / CGRectGetWidth(displayFrame);
        CGFloat scaleY = (CGFloat)CGDisplayPixelsHigh(matchedDisplay.displayID) / CGRectGetHeight(displayFrame);

        CGRect sourceRect = CGRectMake(
            globalRectPoints.origin.x - displayFrame.origin.x,
            globalRectPoints.origin.y - displayFrame.origin.y,
            globalRectPoints.size.width,
            globalRectPoints.size.height
        );
        sourceRect = CGRectIntersection(sourceRect, CGRectMake(0.0, 0.0, displayFrame.size.width, displayFrame.size.height));
        if (CGRectIsNull(sourceRect) || CGRectIsEmpty(sourceRect)) {
            completion(NULL, debugr_make_error(@"The requested capture region was outside the selected display."));
            return;
        }

        SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:matchedDisplay excludingWindows:@[]];
        SCStreamConfiguration *config = [SCStreamConfiguration new];
        config.showsCursor = NO;
        config.sourceRect = sourceRect;
        config.width = (size_t)MAX(1.0, llround(sourceRect.size.width * scaleX));
        config.height = (size_t)MAX(1.0, llround(sourceRect.size.height * scaleY));

        [SCScreenshotManager captureImageWithFilter:filter
                                      configuration:config
                                  completionHandler:^(CGImageRef _Nullable image, NSError * _Nullable captureError) {
            completion(image, captureError);
        }];
    }];
}

bool debugr_capture_region_png_points(
    double x,
    double y,
    double width,
    double height,
    uint8_t **out_bytes,
    uintptr_t *out_len,
    char **out_error
) {
    if (out_bytes != NULL) {
        *out_bytes = NULL;
    }
    if (out_len != NULL) {
        *out_len = 0;
    }
    if (out_error != NULL) {
        *out_error = NULL;
    }

    if (width <= 0.0 || height <= 0.0) {
        if (out_error != NULL) {
            *out_error = debugr_copy_utf8(@"Capture region must be larger than zero.");
        }
        return false;
    }

    __block CGImageRef capturedImage = NULL;
    __block NSError *capturedError = nil;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    CGRect globalRectPoints = CGRectMake(x, y, width, height);

    @autoreleasepool {
        if (@available(macOS 15.2, *)) {
            [SCScreenshotManager captureImageInRect:globalRectPoints
                                  completionHandler:^(CGImageRef _Nullable image, NSError * _Nullable error) {
                if (image != NULL) {
                    capturedImage = CGImageRetain(image);
                }
                capturedError = error;
                dispatch_semaphore_signal(semaphore);
            }];
        } else if (@available(macOS 14.0, *)) {
            debugr_capture_with_filter(globalRectPoints, ^(CGImageRef _Nullable image, NSError * _Nullable error) {
                if (image != NULL) {
                    capturedImage = CGImageRetain(image);
                }
                capturedError = error;
                dispatch_semaphore_signal(semaphore);
            });
        } else {
            capturedError = debugr_make_error(@"ScreenCaptureKit region capture requires macOS 14 or later.");
            dispatch_semaphore_signal(semaphore);
        }

        dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);

        if (capturedImage == NULL) {
            if (out_error != NULL) {
                NSString *message = capturedError.localizedDescription ?: @"ScreenCaptureKit did not return an image.";
                *out_error = debugr_copy_utf8(message);
            }
            return false;
        }

        NSData *pngData = debugr_png_data_from_image(capturedImage);
        CGImageRelease(capturedImage);
        capturedImage = NULL;

        if (pngData == nil || pngData.length == 0) {
            if (out_error != NULL) {
                *out_error = debugr_copy_utf8(@"Failed to encode captured image as PNG.");
            }
            return false;
        }

        uint8_t *copy = malloc(pngData.length);
        if (copy == NULL) {
            if (out_error != NULL) {
                *out_error = debugr_copy_utf8(@"Failed to allocate PNG buffer.");
            }
            return false;
        }
        memcpy(copy, pngData.bytes, pngData.length);

        if (out_bytes != NULL) {
            *out_bytes = copy;
        }
        if (out_len != NULL) {
            *out_len = (uintptr_t)pngData.length;
        }
        return true;
    }
}

void debugr_capture_region_png_free(void *ptr) {
    if (ptr != NULL) {
        free(ptr);
    }
}
