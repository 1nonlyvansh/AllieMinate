# Keep parcelable models
-keep class com.alliminate.android.data.** { *; }

# Keep widget providers
-keep class com.alliminate.android.widget.** { *; }

# Keep NanoHTTPD classes
-keep class fi.iki.elonen.** { *; }

# Keep ZXing
-keep class com.google.zxing.** { *; }
-keep class com.journeyapps.zxing.** { *; }

# Keep WorkManager
-keep class androidx.work.** { *; }

# Keep coroutines
-keep class kotlinx.coroutines.** { *; }

# Keep BiometricPrompt
-keep class androidx.biometric.** { *; }