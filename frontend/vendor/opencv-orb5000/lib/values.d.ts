import type { DMatch as NativeDMatch, KeyPoint as NativeKeyPoint, MainModule, Point2f, RotatedRect as NativeRotatedRect, Size2f } from '../lib/opencv.js';
/** A feature location stored as an ordinary JavaScript value. No disposal is needed. */
export declare class KeyPoint implements NativeKeyPoint {
    /** Diameter of the meaningful feature neighborhood, in pixels. */
    size: number;
    /** Clockwise orientation in degrees [0, 360), or -1 when unspecified. */
    angle: number;
    /** Detector response used to rank features. */
    response: number;
    /** Pyramid octave in which the feature was detected. */
    octave: number;
    /** Application-assigned feature classification identifier, or -1. */
    class_id: number;
    /** Feature center in image pixel coordinates. */
    pt: Point2f;
    /** Create a feature location with its detector scale, orientation and classification metadata. */
    constructor(x?: number, y?: number, 
    /** Diameter of the meaningful feature neighborhood, in pixels. */
    size?: number, 
    /** Clockwise orientation in degrees [0, 360), or -1 when unspecified. */
    angle?: number, 
    /** Detector response used to rank features. */
    response?: number, 
    /** Pyramid octave in which the feature was detected. */
    octave?: number, 
    /** Application-assigned feature classification identifier, or -1. */
    class_id?: number);
}
/** A descriptor match stored as an ordinary JavaScript value. */
export declare class DMatch implements NativeDMatch {
    /** Descriptor row in the query set. */
    queryIdx: number;
    /** Descriptor row in the matched training set. */
    trainIdx: number;
    /** Training image/set index. */
    imgIdx: number;
    /** Descriptor distance under the matcher's metric. */
    distance: number;
    /** Create a descriptor correspondence. Smaller distances indicate closer matches under the chosen metric. */
    constructor(
    /** Descriptor row in the query set. */
    queryIdx?: number, 
    /** Descriptor row in the matched training set. */
    trainIdx?: number, 
    /** Training image/set index. */
    imgIdx?: number, 
    /** Descriptor distance under the matcher's metric. */
    distance?: number);
}
/** A rotated rectangle stored as an ordinary JavaScript value. */
export declare class RotatedRect implements NativeRotatedRect {
    /** Center in image coordinates. */
    center: Point2f;
    /** Rectangle width and height before rotation. */
    size: Size2f;
    /** Clockwise rotation in degrees. */
    angle: number;
    /** Create a rectangle described by its center, extent and clockwise rotation. */
    constructor(
    /** Center in image coordinates. */
    center?: Point2f, 
    /** Rectangle width and height before rotation. */
    size?: Size2f, 
    /** Clockwise rotation in degrees. */
    angle?: number);
}
/** Construct an OpenCV 5 matrix type code with a supported depth and 1 to 128 channels. */
export declare const CV_MAKETYPE: (depth: number, channels: number) => number;
/** JavaScript value constructors and OpenCV 5 matrix type constants/functions. */
export declare const valueAPI: {
    KeyPoint: typeof KeyPoint;
    DMatch: typeof DMatch;
    RotatedRect: typeof RotatedRect;
    CV_MAKETYPE: (depth: number, channels: number) => number;
    /** Alias for CV_MAKETYPE: combine a supported matrix depth and channel count. */
    CV_MAKE_TYPE: (depth: number, channels: number) => number;
    /** Depth code for unsigned 8-bit integer elements. */
    CV_8U: number;
    /** Matrix type with 1 unsigned 8-bit integer channels. */
    CV_8UC1: number;
    /** Matrix type with 2 unsigned 8-bit integer channels. */
    CV_8UC2: number;
    /** Matrix type with 3 unsigned 8-bit integer channels. */
    CV_8UC3: number;
    /** Matrix type with 4 unsigned 8-bit integer channels. */
    CV_8UC4: number;
    /** Construct an unsigned 8-bit integer matrix type with 1 to 128 channels. */
    CV_8UC: (channels: number) => number;
    /** Depth code for signed 8-bit integer elements. */
    CV_8S: number;
    /** Matrix type with 1 signed 8-bit integer channels. */
    CV_8SC1: number;
    /** Matrix type with 2 signed 8-bit integer channels. */
    CV_8SC2: number;
    /** Matrix type with 3 signed 8-bit integer channels. */
    CV_8SC3: number;
    /** Matrix type with 4 signed 8-bit integer channels. */
    CV_8SC4: number;
    /** Construct a signed 8-bit integer matrix type with 1 to 128 channels. */
    CV_8SC: (channels: number) => number;
    /** Depth code for unsigned 16-bit integer elements. */
    CV_16U: number;
    /** Matrix type with 1 unsigned 16-bit integer channels. */
    CV_16UC1: number;
    /** Matrix type with 2 unsigned 16-bit integer channels. */
    CV_16UC2: number;
    /** Matrix type with 3 unsigned 16-bit integer channels. */
    CV_16UC3: number;
    /** Matrix type with 4 unsigned 16-bit integer channels. */
    CV_16UC4: number;
    /** Construct an unsigned 16-bit integer matrix type with 1 to 128 channels. */
    CV_16UC: (channels: number) => number;
    /** Depth code for signed 16-bit integer elements. */
    CV_16S: number;
    /** Matrix type with 1 signed 16-bit integer channels. */
    CV_16SC1: number;
    /** Matrix type with 2 signed 16-bit integer channels. */
    CV_16SC2: number;
    /** Matrix type with 3 signed 16-bit integer channels. */
    CV_16SC3: number;
    /** Matrix type with 4 signed 16-bit integer channels. */
    CV_16SC4: number;
    /** Construct a signed 16-bit integer matrix type with 1 to 128 channels. */
    CV_16SC: (channels: number) => number;
    /** Depth code for signed 32-bit integer elements. */
    CV_32S: number;
    /** Matrix type with 1 signed 32-bit integer channels. */
    CV_32SC1: number;
    /** Matrix type with 2 signed 32-bit integer channels. */
    CV_32SC2: number;
    /** Matrix type with 3 signed 32-bit integer channels. */
    CV_32SC3: number;
    /** Matrix type with 4 signed 32-bit integer channels. */
    CV_32SC4: number;
    /** Construct a signed 32-bit integer matrix type with 1 to 128 channels. */
    CV_32SC: (channels: number) => number;
    /** Depth code for 32-bit floating-point elements. */
    CV_32F: number;
    /** Matrix type with 1 32-bit floating-point channels. */
    CV_32FC1: number;
    /** Matrix type with 2 32-bit floating-point channels. */
    CV_32FC2: number;
    /** Matrix type with 3 32-bit floating-point channels. */
    CV_32FC3: number;
    /** Matrix type with 4 32-bit floating-point channels. */
    CV_32FC4: number;
    /** Construct a 32-bit floating-point matrix type with 1 to 128 channels. */
    CV_32FC: (channels: number) => number;
    /** Depth code for 64-bit floating-point elements. */
    CV_64F: number;
    /** Matrix type with 1 64-bit floating-point channels. */
    CV_64FC1: number;
    /** Matrix type with 2 64-bit floating-point channels. */
    CV_64FC2: number;
    /** Matrix type with 3 64-bit floating-point channels. */
    CV_64FC3: number;
    /** Matrix type with 4 64-bit floating-point channels. */
    CV_64FC4: number;
    /** Construct a 64-bit floating-point matrix type with 1 to 128 channels. */
    CV_64FC: (channels: number) => number;
    /** Depth code for half-precision floating-point elements. */
    CV_16F: number;
    /** Matrix type with 1 half-precision floating-point channels. */
    CV_16FC1: number;
    /** Matrix type with 2 half-precision floating-point channels. */
    CV_16FC2: number;
    /** Matrix type with 3 half-precision floating-point channels. */
    CV_16FC3: number;
    /** Matrix type with 4 half-precision floating-point channels. */
    CV_16FC4: number;
    /** Construct a half-precision floating-point matrix type with 1 to 128 channels. */
    CV_16FC: (channels: number) => number;
    /** Depth code for bfloat16 elements. */
    CV_16BF: number;
    /** Matrix type with 1 bfloat16 channels. */
    CV_16BFC1: number;
    /** Matrix type with 2 bfloat16 channels. */
    CV_16BFC2: number;
    /** Matrix type with 3 bfloat16 channels. */
    CV_16BFC3: number;
    /** Matrix type with 4 bfloat16 channels. */
    CV_16BFC4: number;
    /** Construct a bfloat16 matrix type with 1 to 128 channels. */
    CV_16BFC: (channels: number) => number;
    /** Depth code for boolean elements. */
    CV_Bool: number;
    /** Matrix type with 1 boolean channels. */
    CV_BoolC1: number;
    /** Matrix type with 2 boolean channels. */
    CV_BoolC2: number;
    /** Matrix type with 3 boolean channels. */
    CV_BoolC3: number;
    /** Matrix type with 4 boolean channels. */
    CV_BoolC4: number;
    /** Construct a boolean matrix type with 1 to 128 channels. */
    CV_BoolC: (channels: number) => number;
    /** Depth code for unsigned 64-bit integer elements. */
    CV_64U: number;
    /** Matrix type with 1 unsigned 64-bit integer channels. */
    CV_64UC1: number;
    /** Matrix type with 2 unsigned 64-bit integer channels. */
    CV_64UC2: number;
    /** Matrix type with 3 unsigned 64-bit integer channels. */
    CV_64UC3: number;
    /** Matrix type with 4 unsigned 64-bit integer channels. */
    CV_64UC4: number;
    /** Construct an unsigned 64-bit integer matrix type with 1 to 128 channels. */
    CV_64UC: (channels: number) => number;
    /** Depth code for signed 64-bit integer elements. */
    CV_64S: number;
    /** Matrix type with 1 signed 64-bit integer channels. */
    CV_64SC1: number;
    /** Matrix type with 2 signed 64-bit integer channels. */
    CV_64SC2: number;
    /** Matrix type with 3 signed 64-bit integer channels. */
    CV_64SC3: number;
    /** Matrix type with 4 signed 64-bit integer channels. */
    CV_64SC4: number;
    /** Construct a signed 64-bit integer matrix type with 1 to 128 channels. */
    CV_64SC: (channels: number) => number;
    /** Depth code for unsigned 32-bit integer elements. */
    CV_32U: number;
    /** Matrix type with 1 unsigned 32-bit integer channels. */
    CV_32UC1: number;
    /** Matrix type with 2 unsigned 32-bit integer channels. */
    CV_32UC2: number;
    /** Matrix type with 3 unsigned 32-bit integer channels. */
    CV_32UC3: number;
    /** Matrix type with 4 unsigned 32-bit integer channels. */
    CV_32UC4: number;
    /** Construct an unsigned 32-bit integer matrix type with 1 to 128 channels. */
    CV_32UC: (channels: number) => number;
};
/** Value factories use this instance's native algorithms for geometric operations. */
export declare const createValueAPI: (cv: MainModule) => {
    KeyPoint: {
        new (x?: number, y?: number, size?: number, angle?: number, response?: number, octave?: number, class_id?: number): {
            /** Feature center in image pixel coordinates. */
            pt: Point2f;
            /** Diameter of the meaningful feature neighborhood, in pixels. */
            size: number;
            /** Clockwise orientation in degrees [0, 360), or -1 when unspecified. */
            angle: number;
            /** Detector response used to rank features. */
            response: number;
            /** Pyramid octave in which the feature was detected. */
            octave: number;
            /** Application-assigned feature classification identifier, or -1. */
            class_id: number;
        };
        /** Return the intersection-over-union of the circular neighborhoods of two keypoints. */
        overlap: (kp1: NativeKeyPoint, kp2: NativeKeyPoint) => number;
        /** Convert keypoint locations to point values. The native overload determines the source and destination vectors. */
        convert: (keypoints: import("../lib/opencv.js").KeyPointVector) => import("../lib/opencv.js").Point2fVector;
    };
    RotatedRect: {
        new (center?: Point2f, size?: Size2f, angle?: number): {
            /** Return the four corner coordinates as independent point values. */
            points(): [Point2f, Point2f, Point2f, Point2f];
            /** Return the smallest upright integer rectangle containing this rotated rectangle. */
            boundingRect(): import("./named.js").Rect;
            /** Return the upright floating-point bounds of this rectangle. */
            boundingRect2f(): import("./named.js").Rect2f;
            /** Center in image coordinates. */
            center: Point2f;
            /** Rectangle width and height before rotation. */
            size: Size2f;
            /** Clockwise rotation in degrees. */
            angle: number;
        };
    };
    DMatch: typeof DMatch;
    CV_MAKETYPE: (depth: number, channels: number) => number;
    /** Alias for CV_MAKETYPE: combine a supported matrix depth and channel count. */
    CV_MAKE_TYPE: (depth: number, channels: number) => number;
    /** Depth code for unsigned 8-bit integer elements. */
    CV_8U: number;
    /** Matrix type with 1 unsigned 8-bit integer channels. */
    CV_8UC1: number;
    /** Matrix type with 2 unsigned 8-bit integer channels. */
    CV_8UC2: number;
    /** Matrix type with 3 unsigned 8-bit integer channels. */
    CV_8UC3: number;
    /** Matrix type with 4 unsigned 8-bit integer channels. */
    CV_8UC4: number;
    /** Construct an unsigned 8-bit integer matrix type with 1 to 128 channels. */
    CV_8UC: (channels: number) => number;
    /** Depth code for signed 8-bit integer elements. */
    CV_8S: number;
    /** Matrix type with 1 signed 8-bit integer channels. */
    CV_8SC1: number;
    /** Matrix type with 2 signed 8-bit integer channels. */
    CV_8SC2: number;
    /** Matrix type with 3 signed 8-bit integer channels. */
    CV_8SC3: number;
    /** Matrix type with 4 signed 8-bit integer channels. */
    CV_8SC4: number;
    /** Construct a signed 8-bit integer matrix type with 1 to 128 channels. */
    CV_8SC: (channels: number) => number;
    /** Depth code for unsigned 16-bit integer elements. */
    CV_16U: number;
    /** Matrix type with 1 unsigned 16-bit integer channels. */
    CV_16UC1: number;
    /** Matrix type with 2 unsigned 16-bit integer channels. */
    CV_16UC2: number;
    /** Matrix type with 3 unsigned 16-bit integer channels. */
    CV_16UC3: number;
    /** Matrix type with 4 unsigned 16-bit integer channels. */
    CV_16UC4: number;
    /** Construct an unsigned 16-bit integer matrix type with 1 to 128 channels. */
    CV_16UC: (channels: number) => number;
    /** Depth code for signed 16-bit integer elements. */
    CV_16S: number;
    /** Matrix type with 1 signed 16-bit integer channels. */
    CV_16SC1: number;
    /** Matrix type with 2 signed 16-bit integer channels. */
    CV_16SC2: number;
    /** Matrix type with 3 signed 16-bit integer channels. */
    CV_16SC3: number;
    /** Matrix type with 4 signed 16-bit integer channels. */
    CV_16SC4: number;
    /** Construct a signed 16-bit integer matrix type with 1 to 128 channels. */
    CV_16SC: (channels: number) => number;
    /** Depth code for signed 32-bit integer elements. */
    CV_32S: number;
    /** Matrix type with 1 signed 32-bit integer channels. */
    CV_32SC1: number;
    /** Matrix type with 2 signed 32-bit integer channels. */
    CV_32SC2: number;
    /** Matrix type with 3 signed 32-bit integer channels. */
    CV_32SC3: number;
    /** Matrix type with 4 signed 32-bit integer channels. */
    CV_32SC4: number;
    /** Construct a signed 32-bit integer matrix type with 1 to 128 channels. */
    CV_32SC: (channels: number) => number;
    /** Depth code for 32-bit floating-point elements. */
    CV_32F: number;
    /** Matrix type with 1 32-bit floating-point channels. */
    CV_32FC1: number;
    /** Matrix type with 2 32-bit floating-point channels. */
    CV_32FC2: number;
    /** Matrix type with 3 32-bit floating-point channels. */
    CV_32FC3: number;
    /** Matrix type with 4 32-bit floating-point channels. */
    CV_32FC4: number;
    /** Construct a 32-bit floating-point matrix type with 1 to 128 channels. */
    CV_32FC: (channels: number) => number;
    /** Depth code for 64-bit floating-point elements. */
    CV_64F: number;
    /** Matrix type with 1 64-bit floating-point channels. */
    CV_64FC1: number;
    /** Matrix type with 2 64-bit floating-point channels. */
    CV_64FC2: number;
    /** Matrix type with 3 64-bit floating-point channels. */
    CV_64FC3: number;
    /** Matrix type with 4 64-bit floating-point channels. */
    CV_64FC4: number;
    /** Construct a 64-bit floating-point matrix type with 1 to 128 channels. */
    CV_64FC: (channels: number) => number;
    /** Depth code for half-precision floating-point elements. */
    CV_16F: number;
    /** Matrix type with 1 half-precision floating-point channels. */
    CV_16FC1: number;
    /** Matrix type with 2 half-precision floating-point channels. */
    CV_16FC2: number;
    /** Matrix type with 3 half-precision floating-point channels. */
    CV_16FC3: number;
    /** Matrix type with 4 half-precision floating-point channels. */
    CV_16FC4: number;
    /** Construct a half-precision floating-point matrix type with 1 to 128 channels. */
    CV_16FC: (channels: number) => number;
    /** Depth code for bfloat16 elements. */
    CV_16BF: number;
    /** Matrix type with 1 bfloat16 channels. */
    CV_16BFC1: number;
    /** Matrix type with 2 bfloat16 channels. */
    CV_16BFC2: number;
    /** Matrix type with 3 bfloat16 channels. */
    CV_16BFC3: number;
    /** Matrix type with 4 bfloat16 channels. */
    CV_16BFC4: number;
    /** Construct a bfloat16 matrix type with 1 to 128 channels. */
    CV_16BFC: (channels: number) => number;
    /** Depth code for boolean elements. */
    CV_Bool: number;
    /** Matrix type with 1 boolean channels. */
    CV_BoolC1: number;
    /** Matrix type with 2 boolean channels. */
    CV_BoolC2: number;
    /** Matrix type with 3 boolean channels. */
    CV_BoolC3: number;
    /** Matrix type with 4 boolean channels. */
    CV_BoolC4: number;
    /** Construct a boolean matrix type with 1 to 128 channels. */
    CV_BoolC: (channels: number) => number;
    /** Depth code for unsigned 64-bit integer elements. */
    CV_64U: number;
    /** Matrix type with 1 unsigned 64-bit integer channels. */
    CV_64UC1: number;
    /** Matrix type with 2 unsigned 64-bit integer channels. */
    CV_64UC2: number;
    /** Matrix type with 3 unsigned 64-bit integer channels. */
    CV_64UC3: number;
    /** Matrix type with 4 unsigned 64-bit integer channels. */
    CV_64UC4: number;
    /** Construct an unsigned 64-bit integer matrix type with 1 to 128 channels. */
    CV_64UC: (channels: number) => number;
    /** Depth code for signed 64-bit integer elements. */
    CV_64S: number;
    /** Matrix type with 1 signed 64-bit integer channels. */
    CV_64SC1: number;
    /** Matrix type with 2 signed 64-bit integer channels. */
    CV_64SC2: number;
    /** Matrix type with 3 signed 64-bit integer channels. */
    CV_64SC3: number;
    /** Matrix type with 4 signed 64-bit integer channels. */
    CV_64SC4: number;
    /** Construct a signed 64-bit integer matrix type with 1 to 128 channels. */
    CV_64SC: (channels: number) => number;
    /** Depth code for unsigned 32-bit integer elements. */
    CV_32U: number;
    /** Matrix type with 1 unsigned 32-bit integer channels. */
    CV_32UC1: number;
    /** Matrix type with 2 unsigned 32-bit integer channels. */
    CV_32UC2: number;
    /** Matrix type with 3 unsigned 32-bit integer channels. */
    CV_32UC3: number;
    /** Matrix type with 4 unsigned 32-bit integer channels. */
    CV_32UC4: number;
    /** Construct an unsigned 32-bit integer matrix type with 1 to 128 channels. */
    CV_32UC: (channels: number) => number;
};
//# sourceMappingURL=values.d.ts.map