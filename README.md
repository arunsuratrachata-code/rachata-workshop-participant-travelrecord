# Workshop Distance

A small web app for iPad and phone. It reads a participant's details from a Thai ID card photo, finds the home on the map, calculates the travel distance to that day's workshop venue, and produces a cash receipt (PDF) for each participant.

Live site: <https://arunsuratrachata-code.github.io/rachata-workshop-participant-travelrecord/>

- 📷 Take a photo of the ID card. The Thai name, English name (Name + Last name lines) and address are read on the device, or by Claude AI if you add an API key.
- 🏁 Add a venue for each workshop day. The venue for today is picked automatically.
- 📏 Shows road distance (driving route) and straight-line distance. You can drag the 🏠 pin to fix the home location.
- ✍️ The participant signs on the screen with a finger.
- 🧾 Download a cash receipt PDF per participant: details, road km, round trip × rate, route map, ID photo, amount in words and signature.
- 📄 Export participants to CSV (opens in Excel) for each day or all days.

There is no server and no database. Participant data stays in the browser of the device that recorded it.

## Put it online with GitHub Pages (free)

1. In the repository, click **Add file → Upload files** and drag in `index.html`, `app.js`, `style.css` and `README.md`. Click **Commit changes**.
2. The first time only: go to **Settings → Pages**, set **Source** to **Deploy from a branch**, branch **main**, folder **/ (root)**, and click **Save**.
3. After a minute or two the site is live at the link above. Open it on the iPad or phone and tap **Share → Add to Home Screen**.

To update the app later, upload the changed files again (same names replace the old ones). On the iPad, close and reopen the app to load the new version.

## Using it at the workshop

1. **Settings → Receipt**: check the title, the "Received from" text and the rate (default 5.58 THB per km).
2. **Venues tab**: add the venue for each day. Use **I'm at the venue** (GPS), search the address, paste coordinates or a Google Maps link, or tap the map. Set the date.
3. To use the same venues on a second device, tap **Share setup link** and open the link on that device.
4. **Input page**: check the venue at the top, then tap **Take ID card photo**. Check the names and address. The location, road route, distance and amount appear automatically. **Open route in Google Maps** shows the same trip in Google Maps.
5. Ask the participant to sign in the **Participant signature** box on the Input page, then tap **Save participant**.
6. **Participants tab**: tap **Receipt PDF** next to a person to download their receipt, or **All receipts (PDF)** for everyone in the selected day. Use **Edit / sign** to fix details or add a missing signature or photo.

If the location is rough (district or province only), drag the 🏠 pin or search a nearby village, temple or school before saving.

### Several devices

Each device keeps its own records. To combine them: on each device go to **Settings → Download backup** (it includes ID photos and signatures), send the files to one device, then use **Import backup** there.

### Keep a backup every day

Safari can clear a website's stored data if it isn't opened for about a week. Opening the app from the Home Screen avoids this, but still tap **Settings → Download backup** at the end of each workshop day.

## The receipt

- Amount = round-trip road km × rate. Round trip is twice the one-way km shown (rounded to 0.1 km), and the amount is rounded to the satang.
- The route map is drawn from OpenStreetMap. The receipt also has a clickable **Google Maps route** link so finance can check the distance in Google Maps.
- If the participant did not sign on screen, the signature line is left blank to sign the printed copy by hand.

## Accuracy

- The ID card address usually gives the subdistrict (ตำบล), not the exact house, so the home pin is placed at the village (when its name is on the card and found on the map) or the subdistrict centre. Expect a few km difference unless you move the pin.
- Road distance comes from the OpenStreetMap routing service (OSRM), shortest driving route. Google Maps may differ slightly.
- The on-device reader is free but not perfect: always check the fields before saving. The Claude AI reader is more accurate.

## Privacy

- The ID card photo is stored with the record on the device so it can go on the receipt. With the on-device reader it never leaves the device.
- The ID number is not typed into any field, but it is visible on the ID photo in the receipt.
- With the Claude AI reader, the photo is sent to Anthropic to be read. Check that this is allowed by your organisation's data policy (PDPA) before using it.
- Use **Settings → Delete everything** on each device after the workshop.

## Services used

- Map tiles, address search: [OpenStreetMap](https://www.openstreetmap.org/copyright) / Nominatim (free, max 1 search per second)
- Road routing: [OSRM](https://project-osrm.org/) public demo server (free, best effort)
- On-device text reading: [Tesseract.js](https://github.com/naptha/tesseract.js)
- PDF: [jsPDF](https://github.com/parallax/jsPDF); receipt font: Sarabun (Google Fonts)
- Optional AI reading: [Claude API](https://platform.claude.com/) (needs your own API key, paid per use)
