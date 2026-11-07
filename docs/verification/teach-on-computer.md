# Teach on computer

The owner records a task on a bot's Local VM desktop; the steps go to the bot as
a "save as skill" request, reviewed later in the bot's settings under Skills.

```sh
node --experimental-strip-types scripts/verify-teach-on-computer.ts
```

It builds the renderer, starts the real server on 127.0.0.1 with a temporary
home and data folder and the fake engine, and creates Ada on a Local VM. Only
`container-computer.ts` is replaced (`server/testing/teach-vm-hooks.mjs`): a
drawn sign-in window served to the app's own noVNC viewer by a loopback RFB
server, with screenshots and an AT-SPI-shaped window tree from the same state.
No Docker, real desktop or user data. Ctrl-C stops it and deletes the folder.

Open the printed URL (skip the welcome by `PUT /api/config` with
`{"onboarding":{"completedAt":"…","version":1},"profile":{"name":"Owner"}}`), open Ada's
screen panel and press **Teach on computer**. The composer's + menu → **Teach a
task** (red record icon for a Local VM bot) opens the panel and does the same,
even when the panel was closed.

`--vps` puts Ada on a self-hosted VPS cloud computer instead (the KVM8 backend):
`vps-computer.ts` is replaced as well (`server/testing/teach-vps-mock.mjs`) by the
same drawn desktop, so nothing reaches SSH or Docker. The + menu and the panel
behave the same, and the review names "Ada's cloud desktop".

1. The desktop opens full size in take-control mode with the banner and a red
   **Start recording**; **Not now** closes it.
2. While recording, the bottom pill reads "You're in control · N steps · Stop".
   Click Email, press keys, click Password, press keys, press Enter. Use real
   key presses: text inserted without key events never reaches the desktop.
3. **Stop** lists the steps: clicks name the field ("Email" (entry)), Email
   text is shown, Password text is a hidden step. The typed password appears
   nowhere under the data folder; the recording folder is 0700 and its files
   0600.
4. Add a goal and press **Teach Ada**: the chat gets the request, starting
   "Save the steps below as a reusable skill for my review."
