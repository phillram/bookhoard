# bookhoard

Download all your Libby loans at once.

bookhoard adds a **Download** button to Libby's footer, next to Tags. Click it and it saves every
loan as an EPUB (or PDF), named like `Children of Time - Adrian Tchaikovsky`.

## Install

Get the zip for your browser from the
[latest release](https://github.com/phillram/bookhoard/releases/latest).

**Chrome or Edge**: `bookhoard-vX.Y.Z-chrome.zip`

1. Unzip it.
2. Go to `chrome://extensions` (or `edge://extensions`) and turn on Developer mode.
3. Click **Load unpacked** and pick the unzipped folder.

**Firefox**: `bookhoard-vX.Y.Z-firefox.zip`

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and pick the zip. You'll need to do this again after
   restarting Firefox.

To update, download the new zip and replace the old folder, then click the reload button on
bookhoard in your browser's extensions page.

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
- **Wait between books**: no extra wait by default. If OverDrive's download server says "too many
  requests", bookhoard waits a minute, slows down and tries that book again. If that keeps happening,
  set a few seconds here.

## Something not working?

1. In the options, tick **Debug**.
2. Run it again.
3. Click **Copy log** on the results panel and paste it into a
   [GitHub issue](https://github.com/phillram/bookhoard/issues).

The log has what happened to each book and the file names it chose. It doesn't include your
download links.

## License

MIT
