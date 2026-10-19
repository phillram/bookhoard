# bookhoard

Download all your Libby loans at once.

bookhoard adds a **Download** button to Libby's footer, next to Tags. Click it and it saves every
loan as an EPUB (or PDF), named like `Children of Time - Adrian Tchaikovsky`.

## Install

**Chrome or Edge**

1. Download this repo (Code → Download ZIP) and unzip it.
2. Go to `chrome://extensions` (or `edge://extensions`) and turn on Developer mode.
3. Click **Load unpacked** and pick the unzipped folder.

**Firefox**

1. Download this repo and unzip it.
2. Go to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on** and pick `manifest.json`. You'll need to do this again
   after restarting Firefox.

## Use

1. Open [libbyapp.com/shelf/loans](https://libbyapp.com/shelf/loans).
2. Click **Download** in the footer. Click it again (it says **Stop**) to stop.

If your browser asks about downloading multiple files, say yes.

## Good to know

- Most books download as an `.acsm` file. Open it with
  [Adobe Digital Editions](https://www.adobe.com/solutions/ebook/digital-editions.html) to get
  the book.
- Some books are DRM-free and download as a normal `.epub` or `.pdf`.
- Choosing a format locks that loan to it until you borrow the book again. That's how Libby
  works.
- Skipped: audiobooks, loans you've already downloaded, and books with no EPUB or PDF.
- Loans that say "Open In Libby" or "Open Book" are skipped unless you turn them on in the
  options.

## Options

Click the bookhoard icon in your toolbar.

- **Folder**: where to save, inside your Downloads folder, e.g. `Libby`.
- **File name**: `{title} - {author}` by default. You can use:

  `{title}` `{subtitle}` `{author}` `{authors}` `{authorSort}` `{series}` `{seriesNumber}`
  `{publisher}` `{year}` `{date}` `{isbn}` `{overdriveId}` `{format}` `{drm}` `{library}`
  `{language}`

  Put optional bits in `< >`. They're dropped if empty, so `<{series} {seriesNumber} - >{title}`
  only adds the series for books that have one. Use `/` for folders, like `{author}/{title}`.
- **Format**: EPUB first, EPUB only, or PDF first.
- **Download at most**: handy for trying it out on a few books first.

## License

MIT
