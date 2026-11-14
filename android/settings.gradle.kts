pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // GeckoView(Firefox のエンジン)の配布元
        maven { url = uri("https://maven.mozilla.org/maven2/") }
    }
}

rootProject.name = "easysmarky-android"
include(":app")
