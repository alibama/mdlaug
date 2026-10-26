# mDLAUG

Tools that measure and repair how well digital libraries work for blind and low-vision
people, based on the [Mobile Digital Library Accessibility and Usability Guidelines
(mDLAUG)](https://sites.uwm.edu/mdlaug/).

**Project website: https://alibama.github.io/mdlaug/**

## Start here

| I want to… | Go to |
|---|---|
| **Read the results** of our crawl of 132 digital libraries | [Vendor Accessibility Signals report](https://alibama.github.io/mdlaug/signals/) |
| **Learn to run the crawler** (Windows or Mac, no programming needed) | [Training guide](mdlaug-crawler/TRAINING.md) |
| **Download the data** (spreadsheets, or the full database) | [Data on the project website](https://alibama.github.io/mdlaug/#data) |
| **Fix a library page while I use it** | [Install the Repair browser extension](#repair-extension-in-brief) |

## What's in this repository

| Folder | What it is |
|---|---|
| [`mdlaug-crawler/`](mdlaug-crawler/) | The **crawler**. It visits digital-library sites like a phone does, checks them against mDLAUG, and works out which problems come from the platform vendor. Includes a review app and the statistics behind the report. |
| [`mdlaug-repair-extension/`](mdlaug-repair-extension/) | The **mDLAUG Repair** browser extension, ready to load. Its [README](mdlaug-repair-extension/README.md) is the full manual. |
| [`mdlaug-a11y/`](mdlaug-a11y/) | The extension's development project: tests, the analytics dashboard, the relay, and docs. |
| [`docs/`](docs/) | The project website (served by GitHub Pages). |
| `mdlaug-repair-extension.zip` | The extension, zipped for easy download. |

## What the October 2026 crawl found

- **Cookie banners are a vendor default.** Every Digital Commons site, and 16 of 17 DSpace sites, open a
  cookie-consent overlay that the Escape key doesn't close. The Digital Commons one has no way to reject
  or close it at all.
- **Search results split by vendor.** CONTENTdm results pages never mark their page-number links as
  navigation or flag the current page; DSpace does both on 9 of 10 sites.
- **The platform matters more than the institution.** The type of library (academic, public, museum…)
  explains far less than the software it runs on.

[Read the full report](https://alibama.github.io/mdlaug/signals/), including how each finding was
tested and what it doesn't cover.

## Repair extension in brief

The extension repairs common problems on the page you're looking at (missing labels, unlabelled
buttons, dialogs you can't escape, PDFs that silently download) and can show any page in a consistent,
screen-reader-first **Reading Room**. Everything runs in your browser; nothing is uploaded.

**Before:** a document that is only a link to a file on another server.<br>
<img width="345" height="245" alt="Before: a digital-library page where the document is only a link to a file hosted elsewhere" src="https://github.com/user-attachments/assets/a49ad538-377c-4f12-9c5c-82e644db5c74" />

**After:** with the extension, the same document opens inline as accessible HTML.<br>
<img width="500" height="320" alt="After: the same document shown inline on the page as accessible HTML" src="https://github.com/user-attachments/assets/ce185db6-f736-489e-8ebf-83cbc821067e" />

**Install it in Chrome or Edge**

1. Download **[mdlaug-repair-extension.zip](https://github.com/alibama/mdlaug/raw/main/mdlaug-repair-extension.zip)** and unzip it.
2. Open `chrome://extensions` (or `edge://extensions`) and switch on **Developer mode**.
3. Click **Load unpacked** and choose the unzipped **`mdlaug-repair-extension`** folder.

Then click the extension's icon on any page and choose **Repair this page**. The
[full manual](mdlaug-repair-extension/README.md) covers the Reading Room, the conversion studio,
assessment mode and all 24 mDLAUG situations. [Other ways to install](mdlaug-a11y/INSTALL.md).

Assessments saved from the extension can be shared to a central database and browsed in the
[open analytics app](https://mdlaug.streamlit.app/).

## License

MIT for this code. Bundled libraries keep their own licenses: pdf.js (Apache-2.0), mammoth
(BSD-2-Clause) and axe-core (MPL-2.0).

## Acknowledgements

With thanks to Dr. Iris Xie (University of Wisconsin–Milwaukee) and colleagues, whose mDLAUG
guidelines (https://sites.uwm.edu/mdlaug/) this project implements. This is an independent
implementation.
