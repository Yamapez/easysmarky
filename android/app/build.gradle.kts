import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
}

// 版は package.json を唯一の出どころにする(userscript の @version と同じ値)
val packageJson = JsonSlurper().parse(rootProject.file("../package.json")) as Map<*, *>
val appVersion = packageJson["version"] as String
val (major, minor, patch) = appVersion.split(".").map { it.toInt() }

// 署名鍵は環境変数から(リリース用ワークフローが渡す)。無ければ release は署名しない
val keystorePath: String? = System.getenv("EASYSMARKY_KEYSTORE")

android {
    namespace = "io.github.yamapez.easysmarky"
    // GeckoView 160 が 37.2 以上を要求する(SDK Manager の「Android SDK Platform 37.2」)
    compileSdk {
        version = release(37) { minorApiLevel = 2 }
    }

    defaultConfig {
        applicationId = "io.github.yamapez.easysmarky"
        minSdk = 26
        targetSdk = 36
        versionCode = major * 10000 + minor * 100 + patch
        versionName = appVersion
    }

    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("EASYSMARKY_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("EASYSMARKY_KEY_ALIAS")
                keyPassword = System.getenv("EASYSMARKY_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (keystorePath != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    // GeckoView は ABI ごとに約90MBあるので、APK を ABI で分ける
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64")
            isUniversalApk = false
        }
    }

    // .so を圧縮して APK に入れる。既定(無圧縮)だと APK が約200MBになり、配る側も入れる側も重い
    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("org.mozilla.geckoview:geckoview:160.0.20261104181552")
    // 画面の端(ステータスバー・キーボード)の余白の取得に使う。GeckoView が要求する版に合わせる
    implementation("androidx.core:core:1.19.1")
}

// APK に同梱する easysmarky 本体の写し。Pages から読めなかったときだけ使われる。
// 実体は `npm run build` が作る dist/easysmarky.app.js。
val bundledScript = rootProject.file("../dist/easysmarky.app.js")
// 存在の確認は Copy の外に置く。ソースが無い Copy は NO-SOURCE で飛ばされ、doFirst は実行されないため
val checkBundledScript = tasks.register("checkBundledScript") {
    doLast {
        if (!bundledScript.exists()) {
            throw GradleException("dist/easysmarky.app.js がありません。先にリポジトリ直下で `npm run build` を実行してください。")
        }
    }
}
val syncEasysmarkyScript = tasks.register<Copy>("syncEasysmarkyScript") {
    dependsOn(checkBundledScript)
    from(bundledScript)
    into(layout.projectDirectory.dir("src/main/assets/extension"))
}
tasks.named("preBuild") { dependsOn(syncEasysmarkyScript) }
