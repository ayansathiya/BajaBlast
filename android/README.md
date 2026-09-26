# Baja Blast for Android

The phone page as an app with its own icon. It works on the plain
`http://192.168.x.x:8787` address the house already uses, and finds that
address on the Wi-Fi by itself.

## Getting it onto a phone

On the phone, open

    https://github.com/ayansathiya/BajaBlast/releases/download/android/baja-blast.apk

and tap it when it finishes downloading. Android asks once whether your
browser may install apps. Say yes. Then open **Baja Blast**. It looks for the
kitchen on the Wi-Fi (usually in about three seconds) and opens the calendar.
If it can't find it, type the address shown under Settings on the wall
screen. A Tailscale name (`kitchen.tail1234.ts.net`) works too, from anywhere.

Long-press the icon for **Grocery list**, **Add an event**, **Chores**, and
**Change kitchen address**.

## What it is

It's a single screen showing `/mobile` from the kitchen's own server, the
same page a browser gets. So there's one phone UI, and every change to
`app/mobile.html` reaches the app on the next open with no new APK. The app
adds what a web page can't do for itself:

- **An icon on a plain-http address.** A browser won't install a page as an
  app unless it arrived over HTTPS (README → The phone app). An APK has no
  such rule, so no Tailscale is needed just to get an icon.
- **Finding the kitchen.** The server answers `/health` without a sign-in, so
  the app asks every address on the phone's own Wi-Fi subnet, on port 8787
  only, and takes the one that answers like Baja Blast.
- **Photos**, several at once, from the system picker. It needs no camera or
  storage permission.
- **Links elsewhere open in the browser.** A recipe site or Spotify doesn't
  get trapped inside the app with no address bar.

It asks for two permissions: internet, and "is this phone on Wi-Fi". There are
no libraries, just the Android framework and three Java files. The page's
offline mode (the coral bar, the last calendar it saw) works the same as in a
browser, because it's the page's own service worker doing it.

## How it's built

`.github/workflows/android.yml` builds it whenever anything under `android/`
changes and replaces the APK at the link above. The link never changes, so it
can go in a QR code or a family group chat once and stay there.

That release is marked pre-release and never "latest" on purpose. Every
kitchen box asks GitHub for the latest release to find its own updates, and
if the APK's release were ever the latest one, every box would stop
updating.

### The signing key (do this once)

Android only installs an update over an app signed with **the same key**.
Without a stable key, every new APK would need the old app uninstalled first,
which also throws away the sign-in.

The key must not live in this repository, because the repository is public
and anyone with the key could sign an "update" to your family's app. It goes
in two repository secrets:

1. On GitHub, open the repo's **Settings → Secrets and variables → Actions**
2. **New repository secret**, name `ANDROID_KEYSTORE_BASE64`, paste in the
   contents of `ANDROID_KEYSTORE_BASE64.txt`
3. **New repository secret**, name `ANDROID_KEYSTORE_PASSWORD`, paste in the
   contents of `ANDROID_KEYSTORE_PASSWORD.txt`

Keep `household.jks` and the password somewhere safe, like a password manager.
If they're lost, the next APK won't install over the current one, and every
phone has to uninstall it and reinstall once.

Until the secrets are set, builds still run, but they're signed with a
throwaway key, and the release notes say so.

### Building it yourself

With Android Studio, open `android/` and press Run. Or, with the Android SDK:

```bash
gradle -p android assembleRelease
```

The address and discovery code has plain-Java tests that don't need Android:

```bash
javac -d /tmp/bb android/app/src/main/java/com/bajablast/phone/{Address,Discovery}.java android/test/AddressTest.java
java -cp /tmp/bb AddressTest     # 42 checks
```
