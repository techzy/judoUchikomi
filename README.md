# Uchikomi Coach

A phone web app that gives live audio coaching while drilling **uchikomi** (repeated throw entries, using a band around a pole).

Throws (pick one from the dropdown on the home screen):

| Throw | What it coaches |
|---|---|
| Harai goshi | Hip depth, turn-in, sweep height, straight sweeping leg, support-knee bend, pull hand |
| Ippon seoi nage / Morote seoi nage | Full turn-in, hips low, both knees bent, pull hand (no sweep) |
| Uchi mata | Turn-in, high sweep, straight sweeping leg, slight (not deep) support-knee bend, pull hand |
| Tai otoshi | Turn-in, straight and wide blocking leg, support-knee bend, pull hand |

Each throw keeps its **own reference**. A reference saved before throws were added belongs to Harai goshi. Osoto gari isn't supported yet: it doesn't turn in, so it needs a different rep detector.

Live: **https://judo.lifeofjeso.ca**

## How it works

- **MediaPipe Pose Landmarker** runs on the device in the browser. It's loaded at runtime from CDNs:
  - JS and WebAssembly: `cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/...`
  - Model: `storage.googleapis.com/mediapipe-models/pose_landmarker/...`
- The app calibrates while you stand still, detects each rep by how far your body turns, and scores it with the metrics for the selected throw (defined in the `THROWS` table in `index.html`). It speaks one cue per rep through the browser's speech engine.
- Sessions, settings and the reference are saved in `localStorage` on the phone. There's no backend.
- The camera only works over HTTPS (Vercel provides it).

## Privacy and analytics

- On first open, a popup asks whether to share anonymous usage stats. **Nothing is loaded or sent until the person taps OK.** "No thanks" turns analytics off, and the choice can be changed later under Settings → Privacy. The choice is stored in `localStorage` under `uchikomi.consent`.
- Analytics go to **PostHog** (US cloud, project "Default project"). `posthog-js` is pinned to `1.447.6` and loaded from jsdelivr. Session replay, autocapture, heatmaps and console-log capture are all **off**. The camera feed is never recorded or sent anywhere, and the drill screen also has the `ph-no-capture` class as a backstop.
- Events:

  | Event | Properties |
  |---|---|
  | `$pageview` | (standard) |
  | `drill started` | `throw`, `hand`, `used_reference`, `camera`, `model` |
  | `drill ended` | `duration_s` (Start drill → End), `reps`, `avg_score`, `best_score`, `throw`, `used_reference`, `hand`, `calibration_s` |
  | `camera blocked` | `mode`, `error` |
  | `calibration slow` | `mode`, `throw`, `seconds` (sent when calibration takes over 10 s) |
  | `calibration failed` | `mode`, `throw`, `seconds_waited` (the run ended before calibration finished) |
  | `settings changed` | `setting`, `value` (choosing a throw sends `setting: throw`) |
  | `reference recorded` | `throw`, `source` (`live`, `video` or `session rep`), `reps` |

- **After-session feedback:** when a drill with at least one rep ends, a popup asks *"Is there anything you wish this app would do?"* with a text box, **Send** and a close **×**. It appears after the first finished drill, then at most once every 30 days (`uchikomi.feedbackAt`), and only for people who said OK to analytics. Answers are sent as responses to the PostHog API survey **"Uchikomi Coach: after-session wish"**, so they show up under Surveys in PostHog.

## Using it on an iPhone

1. Open the site in **Safari**, then Share → **Add to Home Screen**. This opens it full-screen and stops Safari wiping saved sessions after about 7 days of not visiting the site.
2. Allow the camera when asked.
3. Prop the phone at about 45° to the pole with your whole body in frame. Tap **Start drill** and stand still facing the pole until it says "Go".
4. If you don't hear cues, check the volume and the silent switch.
5. If something fails (camera, model loading, speech), connect the phone to Safari Web Inspector on a Mac to see the console errors.

## Project layout

| File | What it is |
|---|---|
| `index.html` | The whole app: HTML, CSS and one `<script type="module">`. No build step. |
| `test/analysis.test.mjs` | Node tests for rep detection and scoring. They pull the module script out of `index.html` and feed it synthetic skeletons. |
| `package.json` | Only for `npm test`. No dependencies. |
| `.vercelignore` | Keeps tests, `package.json` and this README out of the deployed site. |

## Tests

```bash
npm test
```

You need Node 18 or newer. There's nothing to install.

## Deploying

Vercel hosts the site as a plain static site, with no build step. Every push to `main` deploys to production automatically.

DNS for `lifeofjeso.ca` is at GoDaddy. The `judo` subdomain is a CNAME pointing to Vercel. The main blog (Substack) isn't affected.
