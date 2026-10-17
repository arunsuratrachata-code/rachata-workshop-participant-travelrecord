# Workshop Distance

A small web app for iPad and phone. It reads a participant's address from a Thai ID card photo, finds the home on the map, and calculates the travel distance to that day's workshop venue.

- 📷 Take a photo of the ID card. The address is read on the device (or by Claude AI if you add an API key).
- 🏁 Add a venue for each workshop day. The venue for today is picked automatically.
- 📏 Shows road distance (driving route) and straight-line distance. You can drag the 🏠 pin to fix the home location.
- 📄 Export participants to CSV (opens in Excel) for each day or all days.

There is no server and no database. Participant data stays in the browser of the device that recorded it.

## Put it online with GitHub Pages (free)

You need a free GitHub account.

1. Sign in at <https://github.com> and click **New repository** (the **+** at the top right).
2. Name it, for example `workshop-distance`. Choose **Public** (free GitHub Pages needs a public repository; the code contains no participant data). Click **Create repository**.
3. On the new repository page, click **uploading an existing file**.
4. Drag in these files: `index.html`, `app.js`, `style.css`, `README.md`, `.nojekyll`. Click **Commit changes**.
   - `.nojekyll` is hidden on some computers. It is optional; skip it if you can't see it.
5. Go to **Settings → Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, branch **main**, folder **/ (root)**, and click **Save**.
6. After a minute or two, the page shows your link, like `https://YOUR-USERNAME.github.io/workshop-distance/`.
7. Open that link on the iPad or phone in Safari or Chrome. Tap **Share → Add to Home Screen** so it opens like an app.

GitHub Pages uses HTTPS, which the camera and the "use my current location" button need.

To update the app later, upload the changed files to the same repository. The site updates within a minute or two.

## Using it at the workshop

1. **Venues tab**: add the venue for each day. Use **I'm at the venue** (GPS), search the address, paste coordinates or a Google Maps link, or tap the map. Set the date.
2. To use the same venues on a second device, tap **Share setup link** and open the link on that device.
3. **Scan tab**: check the venue at the top, then tap **Take ID card photo**. Check the name and address. The location and distance appear automatically. Tap **Save participant**.
4. If the location is rough (district or province only), drag the 🏠 pin or search a nearby village, temple or school.
5. **Participants tab**: see everyone by day, edit or delete records, and **Export CSV**.

### Several devices

Each device keeps its own records. To combine them: on each device go to **Settings → Download backup**, send the files to one device, then use **Import backup** there. Then export one CSV.

## Accuracy

- The ID card address usually gives the subdistrict (ตำบล), not the exact house, so the home pin is placed at the village (when its name is on the card and found on the map) or the subdistrict centre. Expect a few km difference unless you move the pin.
- Road distance comes from the OpenStreetMap routing service (OSRM), shortest driving route.
- The on-device reader is free but not perfect: always check the fields before saving. The Claude AI reader is more accurate.

## Privacy

- The ID card photo is not saved. With the on-device reader it never leaves the device.
- The ID number is not collected.
- With the Claude AI reader, the photo is sent to Anthropic to be read. Check that this is allowed by your organisation's data policy (PDPA) before using it.
- Records and the API key are stored in the browser of each device. Use **Settings → Delete everything** after the workshop.

## Services used

- Map tiles, address search: [OpenStreetMap](https://www.openstreetmap.org/copyright) / Nominatim (free, max 1 search per second)
- Road routing: [OSRM](https://project-osrm.org/) public demo server (free, best effort)
- On-device text reading: [Tesseract.js](https://github.com/naptha/tesseract.js)
- Optional AI reading: [Claude API](https://platform.claude.com/) (needs your own API key, paid per use)

The free map services are fine for workshop-sized groups. For hundreds of scans a day, consider a paid geocoding/routing provider.
