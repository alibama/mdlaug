# Store listing copy

Paste-ready text for the Chrome Web Store and Edge Add-ons. Keep it in sync with
the manifest and with the privacy policy at https://alibama.github.io/mdlaug/privacy/.

## Name
mDLAUG Repair — digital library accessibility

## Summary (≤132 characters; same as the manifest description)
Repairs the 24 mDLAUG screen-reader barriers on any page and converts PDF/DOCX to accessible formats, all client-side.

## Category
Chrome: **Accessibility**. Edge: **Accessibility**.

## Language
English

## Description

mDLAUG Repair makes digital libraries easier to use with a screen reader or on a phone.

Built on the Mobile Digital Library Accessibility and Usability Guidelines (mDLAUG) from the
University of Wisconsin–Milwaukee, it repairs the most common barriers on the page you are reading:

• Adds missing labels to search boxes, buttons and links
• Lets you escape dialogs and cookie banners that trap the keyboard
• Opens PDFs and Word files inline as accessible, reflowed HTML instead of silently downloading them
• Shows any page in a consistent, screen-reader-first Reading Room
• Includes ready-made fixes for DSpace, Blacklight, Islandora, Omeka and IIIF viewers

For librarians and accessibility reviewers there is also an assessment mode. It scores a page
against all 24 mDLAUG situations, lets you add notes and evidence, and saves the result.

Private by default: repairs and conversions run entirely in your browser. Assessments stay in your
browser unless you choose to share them with the mDLAUG project's open research database.

Open source: https://github.com/alibama/mdlaug
Independent project. Not affiliated with or endorsed by the authors of the mDLAUG guidelines.

## Single purpose (Chrome "Privacy practices" tab)
Improve the accessibility of digital-library web pages for screen-reader and mobile users by
repairing mDLAUG barriers on the current page and converting linked documents to accessible formats.

## Permission justifications

| Permission | Justification |
|---|---|
| Host permission `<all_urls>` and content script on all sites | Digital libraries are hosted on thousands of institutional domains, so no fixed list is possible. The content script repairs accessibility barriers on the page the user is reading, and the background worker fetches linked PDF/DOCX files from that site so they can be converted to accessible HTML in the browser. |
| `activeTab` | Runs the popup's actions ("Repair this page", "Assess this page") on the tab the user is looking at, and captures an evidence screenshot of the visible tab when the user asks for one. |
| `scripting` | Injects the bundled document converters (pdf.js, mammoth) into the current tab only when the user converts a document, so they are not loaded on every page. |
| `storage` | Saves the user's settings, custom fix packs and assessment drafts locally. |

**Remote code:** No. All code is in the package. pdf.js and mammoth are bundled in `vendor/`.

## Data usage (Chrome "Privacy practices" form)

Tick:
- **Website content**: the extension reads the current page to repair it (processed locally). If
  the user opts in to sharing assessments, the page title and address, scores, notes and evidence
  screenshots are sent to the project's research database.
- **Personally identifiable information**: only the optional assessor name the user types, and only if they opt in to sharing.

Certify all three:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

Privacy policy URL: https://alibama.github.io/mdlaug/privacy/

## Notes for reviewers (Edge "Notes for certification"; Chrome reviewers can be pointed here too)
Test page: any digital-library item page, for example a DSpace or Omeka record. Click the toolbar
icon and choose "Repair this page". No login is needed. Sharing with the project database is off by
default (Options → Assessment storage).

## Screenshots to capture (1280×800)
1. A library item page before and after "Repair this page" (the badge shows the number of fixes).
2. A PDF opened inline as accessible HTML.
3. The Reading Room view.
4. The assessment page scoring the 24 mDLAUG situations.
