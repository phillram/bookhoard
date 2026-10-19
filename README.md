# bookhoard

Download all your Libby books at once, with proper file names. Return them all at once when
you're done.

bookhoard adds two buttons to the bottom of Libby in your browser:

![Libby's footer with bookhoard's Download and Return buttons on the right](docs/footer.png)

- **Download** saves every book you've borrowed, named like `Children of Time - Adrian Tchaikovsky`.
- **Return** sends back the books you pick.

## Install

Download the zip for your browser from the
[latest release](https://github.com/phillram/bookhoard/releases/latest).

**Chrome or Edge**

1. Unzip `bookhoard-…-chrome.zip` into a folder you'll keep, like `Documents\bookhoard`.
   Chrome runs bookhoard from that folder, so deleting it removes bookhoard.
2. Go to `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and pick the folder.

To update, unzip the new version into the same folder and click the reload button on bookhoard.

**Firefox**

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and pick `bookhoard-…-firefox.zip`.

Firefox removes it when you close the browser, so you'll need to do this again next time.

## Download your books

1. Open your loans at [libbyapp.com/shelf/loans](https://libbyapp.com/shelf/loans).
2. Click **Download** at the bottom.
3. If your browser asks about downloading several files, click **Allow**.

A panel shows how it's going. You can **Pause** or **Stop** at any time.

![The progress panel listing books as they download](docs/downloading.png)

Most books come as an `.acsm` file. Open it in
[Adobe Digital Editions](https://www.adobe.com/solutions/ebook/digital-editions.html) to get the
book itself. A few come as a plain `.epub` or `.pdf`, ready to read.

## Return your books

1. Click **Return** at the bottom.
2. Tick the books to send back, then click **Return**.

Books you haven't downloaded yet start unticked, so you don't return one by accident.

![The Return list with a checkbox for each book](docs/return.png)

## Options

Click the bookhoard icon in your browser's toolbar to choose how files are named, where they're
saved, and which format to get.

![The options page](docs/options.png)

## Good to know

- Choosing EPUB or PDF locks that loan to the format until you borrow the book again. That's
  how Libby works.
- Audiobooks are skipped, and so are books Libby only lets you read in its app or on Kindle.
- After updating bookhoard, reload your Libby tab.
- Books bookhoard has downloaded before are skipped, even if you've moved the files. Untick
  **Skip books already downloaded** in the options to get them again.

## Something not working?

Click **Copy log** on the panel and paste it into a
[new issue](https://github.com/phillram/bookhoard/issues). It lists your book titles and what
happened to each one, but not your download links.

## License

MIT
