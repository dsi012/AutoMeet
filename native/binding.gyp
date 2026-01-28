{
  "targets": [
    {
      "target_name": "screencapture",
      "sources": [
        "screencapture.mm"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LIBRARY": "libc++",
        "MACOSX_DEPLOYMENT_TARGET": "13.0",
        "OTHER_CFLAGS": [
          "-ObjC++",
          "-fobjc-arc"
        ]
      },
      "link_settings": {
        "libraries": [
          "-framework ScreenCaptureKit",
          "-framework AVFoundation",
          "-framework CoreMedia",
          "-framework CoreAudio",
          "-framework Foundation"
        ]
      },
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES"
          }
        }]
      ]
    }
  ]
}


