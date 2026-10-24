# Baja Blast for iPhone

A real app for each person's phone. It finds the kitchen by itself — no
address to type — then asks "Who are you?" once and from then on opens on
that person's welcome: their day, their chores, dinner, groceries,
reminders, timers, the weather, and every tab the phone page has.

The screens come from the kitchen (app/mobile.html), so new features reach
the app without reinstalling it.

## Putting it on a phone (free Apple ID)

Needs Xcode (Mac App Store) on the Mac mini, and each iPhone plugged in once.

1. Open `ios/BajaBlast.xcodeproj` in Xcode.
2. Click **BajaBlast** at the top of the left column → **Signing &
   Capabilities** → **Team** → **Add an Account…**, sign in with your Apple
   ID, and pick it ("Personal Team").
3. If it says the bundle identifier is taken, change
   `com.bajablast.phone` to something of your own, e.g.
   `com.yourname.bajablast`.
4. Plug the iPhone into the Mac with a cable, unlock it, tap **Trust**.
5. Pick the iPhone at the top of Xcode, then press **▶ Run**.
6. On the iPhone, the first time only: **Settings → General → VPN & Device
   Management → your Apple ID → Trust**. Also turn on
   **Settings → Privacy & Security → Developer Mode** if it asks, and restart.
7. Open Baja Blast. Allow it to **find devices on your local network**
   when it asks — that's how it finds the kitchen.

With a free Apple ID, Apple stops the app working after **7 days**; plug the
phone in and press Run again to renew it. Up to 3 phones per Apple ID.

## Later: TestFlight (paid Apple Developer account, $99/year)

No cables and no weekly renewal. With the account in Xcode:
**Product → Archive → Distribute App → TestFlight**, then add each person as
a tester in App Store Connect. They install **TestFlight** from the App Store
and get Baja Blast from there; updates arrive the same way.

## Changing the project

The project file is generated from `project.yml`:

```bash
brew install xcodegen
cd ios && xcodegen
```
