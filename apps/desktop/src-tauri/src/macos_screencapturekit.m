#import <AppKit/AppKit.h>
#import <CoreFoundation/CoreFoundation.h>
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

/// ScreenCaptureKit delivers callbacks on the main queue; blocking the main thread with a bare semaphore wait deadlocks.
/// Pumping the main run loop lets those callbacks run while we wait from Rust/Tauri on the main thread.
static void debugr_dispatch_semaphore_wait_forever(dispatch_semaphore_t sem) {
    if ([NSThread isMainThread]) {
        while (dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 0)) != 0) {
            CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.02, YES);
        }
    } else {
        dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);
    }
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

        debugr_dispatch_semaphore_wait_forever(semaphore);

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

// ── Full display / window capture + source listing (picker + image-space crop in UI) ──

static bool debugr_emit_png_buffer(NSData *pngData, uint8_t **out_bytes, uintptr_t *out_len, char **out_error) {
    if (pngData == nil || pngData.length == 0) {
        if (out_error != NULL) {
            *out_error = debugr_copy_utf8(@"Empty PNG buffer.");
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

static bool debugr_capture_filter_png_sync(
    SCContentFilter *filter,
    SCDisplay *matchedDisplay,
    CGRect sourceRectInDisplaySpace,
    uint8_t **out_bytes,
    uintptr_t *out_len,
    char **out_error
) API_AVAILABLE(macos(14.0)) {
    CGRect displayFrame = matchedDisplay.frame;
    if (CGRectGetWidth(displayFrame) <= 0.0 || CGRectGetHeight(displayFrame) <= 0.0) {
        if (out_error != NULL) {
            *out_error = debugr_copy_utf8(@"Display frame invalid.");
        }
        return false;
    }
    CGFloat scaleX = (CGFloat)CGDisplayPixelsWide(matchedDisplay.displayID) / CGRectGetWidth(displayFrame);
    CGFloat scaleY = (CGFloat)CGDisplayPixelsHigh(matchedDisplay.displayID) / CGRectGetHeight(displayFrame);

    SCStreamConfiguration *config = [SCStreamConfiguration new];
    config.showsCursor = NO;
    config.sourceRect = sourceRectInDisplaySpace;
    config.width = (size_t)MAX(1.0, llround(sourceRectInDisplaySpace.size.width * scaleX));
    config.height = (size_t)MAX(1.0, llround(sourceRectInDisplaySpace.size.height * scaleY));

    __block CGImageRef capturedImage = NULL;
    __block NSError *capturedError = nil;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);

    [SCScreenshotManager captureImageWithFilter:filter
                                  configuration:config
                              completionHandler:^(CGImageRef _Nullable image, NSError *_Nullable captureError) {
        if (image != NULL) {
            capturedImage = CGImageRetain(image);
        }
        capturedError = captureError;
        dispatch_semaphore_signal(semaphore);
    }];
    debugr_dispatch_semaphore_wait_forever(semaphore);

    if (capturedImage == NULL) {
        if (out_error != NULL) {
            NSString *message = capturedError.localizedDescription ?: @"ScreenCaptureKit did not return an image.";
            *out_error = debugr_copy_utf8(message);
        }
        return false;
    }

    NSData *pngData = debugr_png_data_from_image(capturedImage);
    CGImageRelease(capturedImage);

    return debugr_emit_png_buffer(pngData, out_bytes, out_len, out_error);
}

static SCDisplay *debugr_display_containing_point(SCShareableContent *content, CGPoint p) {
    for (SCDisplay *d in content.displays) {
        if (CGRectContainsPoint(d.frame, p)) {
            return d;
        }
    }
    return content.displays.firstObject;
}

bool debugr_list_capture_sources_json(char **out_json, char **out_error) {
    if (out_json != NULL) {
        *out_json = NULL;
    }
    if (out_error != NULL) {
        *out_error = NULL;
    }

    if (@available(macOS 14.0, *)) {
    } else {
        if (out_error != NULL) {
            *out_error = debugr_copy_utf8(@"Listing capture sources requires macOS 14 or later.");
        }
        return false;
    }

    /*
     * Never request Screen Recording access from source listing.
     *
     * This path runs during normal chooser/session flow, so requesting Screen
     * Recording here can summon Apple's blocking modal over Dbugr even when
     * the user only expected to pick a session or refresh a list.
     *
     * Do not hard-fail on CGPreflightScreenCaptureAccess() either. On unsigned
     * or freshly rebuilt local bundles macOS can report a stale false preflight
     * while ScreenCaptureKit is still allowed to list content. Let
     * SCShareableContent be the source of truth, and only surface its real error.
     */

    __block NSDictionary *rootObj = nil;
    __block NSError *listErr = nil;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    /* ScreenCaptureKit expects the request from the main queue; wait from a worker thread (Rust spawn_blocking). */
    dispatch_async(dispatch_get_main_queue(), ^{
        [SCShareableContent getShareableContentWithCompletionHandler:^(
            SCShareableContent *_Nullable shareableContent,
            NSError *_Nullable shareableError
        ) {
            if (shareableError != nil) {
                listErr = shareableError;
                dispatch_semaphore_signal(sem);
                return;
            }
            if (shareableContent == nil) {
                listErr = debugr_make_error(@"No shareable content.");
                dispatch_semaphore_signal(sem);
                return;
            }

            NSMutableArray *displays = [NSMutableArray array];
            for (SCDisplay *d in shareableContent.displays) {
                NSString *label = [NSString stringWithFormat:@"Screen — %.0f×%.0f pt",
                                   d.frame.size.width, d.frame.size.height];
                [displays addObject:@{ @"kind": @"display", @"id": @(d.displayID), @"label": label }];
            }

            NSMutableArray *windows = [NSMutableArray array];
            NSUInteger winCap = 120;
            NSUInteger n = 0;
            for (SCWindow *w in shareableContent.windows) {
                if (w.frame.size.width < 48 || w.frame.size.height < 48) {
                    continue;
                }
                NSString *title = (w.title.length > 0) ? w.title : @"(untitled window)";
                NSString *own = w.owningApplication.applicationName ?: @"";
                NSString *label = (own.length > 0)
                    ? [NSString stringWithFormat:@"%@ — %@", own, title]
                    : title;
                [windows addObject:@{ @"kind": @"window", @"id": @(w.windowID), @"label": label }];
                n++;
                if (n >= winCap) {
                    break;
                }
            }

            rootObj = @{ @"displays": displays, @"windows": windows };
            dispatch_semaphore_signal(sem);
        }];
    });

    debugr_dispatch_semaphore_wait_forever(sem);

    if (listErr != nil) {
        if (out_error != NULL) {
            NSString *detail = [NSString stringWithFormat:@"%@ [%@ %ld]",
                                listErr.localizedDescription ?: @"Could not list capture sources.",
                                listErr.domain,
                                (long)listErr.code];
            *out_error = debugr_copy_utf8(detail);
        }
        return false;
    }

    NSError *jsonErr = nil;
    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:rootObj options:0 error:&jsonErr];
    if (jsonData == nil) {
        if (out_error != NULL) {
            *out_error = debugr_copy_utf8(jsonErr.localizedDescription ?: @"JSON encode failed.");
        }
        return false;
    }

    NSString *jsonStr = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
    const char *utf8 = jsonStr.UTF8String;
    size_t len = strlen(utf8);
    char *copy = malloc(len + 1);
    if (copy == NULL) {
        if (out_error != NULL) {
            *out_error = debugr_copy_utf8(@"Allocation failed.");
        }
        return false;
    }
    memcpy(copy, utf8, len + 1);
    if (out_json != NULL) {
        *out_json = copy;
    }
    return true;
}

bool debugr_capture_display_full_png(
    uint32_t display_id,
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

    if (@available(macOS 14.0, *)) {
    } else {
        if (out_error != NULL) {
            *out_error = debugr_copy_utf8(@"Display capture requires macOS 14 or later.");
        }
        return false;
    }

    __block SCDisplay *target = nil;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    dispatch_async(dispatch_get_main_queue(), ^{
        [SCShareableContent getShareableContentWithCompletionHandler:^(
            SCShareableContent *_Nullable shareableContent,
            NSError *_Nullable shareableError
        ) {
            if (shareableError != nil || shareableContent == nil) {
                dispatch_semaphore_signal(sem);
                return;
            }
            for (SCDisplay *d in shareableContent.displays) {
                if (d.displayID == display_id) {
                    target = d;
                    break;
                }
            }
            dispatch_semaphore_signal(sem);
        }];
    });
    debugr_dispatch_semaphore_wait_forever(sem);

    if (target == nil) {
        if (out_error != NULL) {
            *out_error = debugr_copy_utf8(@"Display not found for capture.");
        }
        return false;
    }

    CGRect df = target.frame;
    CGRect sourceRect = CGRectMake(0, 0, df.size.width, df.size.height);

    if (@available(macOS 14.0, *)) {
        SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:target excludingWindows:@[]];
        return debugr_capture_filter_png_sync(filter, target, sourceRect, out_bytes, out_len, out_error);
    }

    if (out_error != NULL) {
        *out_error = debugr_copy_utf8(@"Display capture unavailable.");
    }
    return false;
}

bool debugr_capture_window_full_png(
    uint32_t window_id,
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

    if (@available(macOS 14.0, *)) {
    } else {
        if (out_error != NULL) {
            *out_error = debugr_copy_utf8(@"Window capture requires macOS 14 or later.");
        }
        return false;
    }

    __block SCWindow *targetWin = nil;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    dispatch_async(dispatch_get_main_queue(), ^{
        [SCShareableContent getShareableContentWithCompletionHandler:^(
            SCShareableContent *_Nullable shareableContent,
            NSError *_Nullable shareableError
        ) {
            if (shareableError != nil || shareableContent == nil) {
                dispatch_semaphore_signal(sem);
                return;
            }
            for (SCWindow *w in shareableContent.windows) {
                if (w.windowID == window_id) {
                    targetWin = w;
                    break;
                }
            }
            dispatch_semaphore_signal(sem);
        }];
    });
    debugr_dispatch_semaphore_wait_forever(sem);

    if (targetWin == nil) {
        if (out_error != NULL) {
            *out_error = debugr_copy_utf8(@"Window not found for capture.");
        }
        return false;
    }

    CGPoint center = CGPointMake(CGRectGetMidX(targetWin.frame), CGRectGetMidY(targetWin.frame));

    __block SCShareableContent *contentForDisplay = nil;
    dispatch_semaphore_t sem2 = dispatch_semaphore_create(0);
    dispatch_async(dispatch_get_main_queue(), ^{
        [SCShareableContent getShareableContentWithCompletionHandler:^(
            SCShareableContent *_Nullable shareableContent,
            NSError *_Nullable shareableError
        ) {
            if (shareableError != nil) {
                contentForDisplay = nil;
                dispatch_semaphore_signal(sem2);
                return;
            }
            contentForDisplay = shareableContent;
            dispatch_semaphore_signal(sem2);
        }];
    });
    debugr_dispatch_semaphore_wait_forever(sem2);

    if (contentForDisplay == nil) {
        if (out_error != NULL) {
            *out_error = debugr_copy_utf8(@"Could not load displays for window capture.");
        }
        return false;
    }

    SCDisplay *matchedDisplay = debugr_display_containing_point(contentForDisplay, center);
    if (matchedDisplay == nil) {
        if (out_error != NULL) {
            *out_error = debugr_copy_utf8(@"Could not match window to a display.");
        }
        return false;
    }

    CGRect wf = targetWin.frame;
    CGRect df = matchedDisplay.frame;
    CGRect sourceRect = CGRectMake(
        wf.origin.x - df.origin.x,
        wf.origin.y - df.origin.y,
        wf.size.width,
        wf.size.height
    );
    sourceRect = CGRectIntersection(sourceRect, CGRectMake(0, 0, df.size.width, df.size.height));
    if (CGRectIsNull(sourceRect) || CGRectIsEmpty(sourceRect)) {
        if (out_error != NULL) {
            *out_error = debugr_copy_utf8(@"Window rect outside display bounds.");
        }
        return false;
    }

    if (@available(macOS 14.0, *)) {
        SCContentFilter *filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:targetWin];
        return debugr_capture_filter_png_sync(filter, matchedDisplay, sourceRect, out_bytes, out_len, out_error);
    }

    if (out_error != NULL) {
        *out_error = debugr_copy_utf8(@"Window capture unavailable.");
    }
    return false;
}
