# bookhoard

Download all your Libby books at once, with proper file names. Return them all at once when
you're done. Borrow a whole series in one go. Open the books you can only read online, one after
another.

bookhoard adds a button to the bottom of Libby in your browser. Click it to choose:

![Libby's footer with the bookhoard button and its menu: Download, Return and Borrow](docs/footer.png)

- **Open in reader** opens the books you can only read online (in Media Do's reader or Libby's).
  It only shows when you have some.
- **Download** saves the books you've borrowed, named like `Children of Time - Adrian Tchaikovsky`.
- **Return** sends back the books you pick.
- **Borrow** borrows the books listed on a page, like a whole series. It only shows on those pages.

To have them as separate buttons instead, choose that under **Buttons in Libby** in the options.
They're still combined into one when there isn't room for them all, like while you have a book open
in Libby.

## Install

Download the zip for your browser from the
[latest release](https://github.com/phillram/bookhoard/releases/latest).

**Chrome or Edge**

1. Unzip `bookhoard-…-chrome.zip` into a folder you'll keep, like `Documents\bookhoard`.
   Chrome runs bookhoard from that folder, so deleting it removes bookhoard.
2. Go to `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and pick the folder.

To update, unzip the new version into the same folder, click the reload button on bookhoard, then
reload your Libby tab.

**Firefox**

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and pick `bookhoard-…-firefox.zip`.

Firefox removes it when you close the browser, so you'll need to do this again next time.

## Read your online-only books

Some books can't be downloaded, only read online: in Media Do's reader (often manga; they say
**Read With Media Do** on your shelf), or only in Libby's own reader (often comics and picture
books). Books only for Kindle aren't included.

1. Click the bookhoard button at the bottom, then **Open in reader**.
2. Check the books you want, then click **Open**. **Media Do** and **Libby** pick all the books of
   that kind. The list is in title order, with volumes in number order.

The first book opens in a tab of its own, in its reader. When you close that tab, you're back on
Libby and the next one opens. To stop before the next one, press **Stop** on the Libby tab.

To open them all at once instead, each in its own tab behind the Libby tab, choose that under
**Open in reader** in the options.

If Libby won't open two in a row (it may limit how many open in a short time), bookhoard stops and
shows Libby's message; try again in a few minutes.

## Download your books

1. Open your loans at [libbyapp.com/shelf/loans](https://libbyapp.com/shelf/loans).
2. Click the bookhoard button at the bottom, then **Download**.
3. Check the books you want, then click **Download**.
4. If your browser asks about downloading several files, click **Allow**.

![The Download list with a checkbox for each book](docs/download.png)

Only books with an EPUB or PDF start checked. Books you've downloaded before, audiobooks, and books
you can only read online start unchecked, and the list says why. If you check some you've downloaded
before, the button says so, like **Download 12 (2 again)**.

![The progress panel listing books as they download](docs/downloading.png)

Most books come as an `.acsm` file. Open it in
[Adobe Digital Editions](https://www.adobe.com/solutions/ebook/digital-editions.html) to get the
book itself. A few come as a plain `.epub` or `.pdf`, ready to read.

Libby blocks downloads for a while if you take too many too quickly, so bookhoard takes a short
break every few books (2 minutes after every 10, unless you change it in the options). If Libby
asks it to slow down anyway, bookhoard waits two minutes and carries on.

## Return your books

1. Click the bookhoard button at the bottom, then **Return**.
2. Check the books to send back, then click **Return**.

Books you haven't downloaded yet start unchecked, so you don't return one by accident. **Downloaded**
picks the ones you have, and **Media Do** and **Libby** pick the books you read online. Returning
can't be undone: you'd have to borrow the book again.

![The Return list with a checkbox for each book](docs/return.png)

## Borrow a series

1. Open a book that's part of a series, or the series itself.
2. Click the bookhoard button at the bottom, then **Borrow**. On a book's page, bookhoard opens its
   series first.
3. Check the books you want, then click **Borrow**. Books with a waitlist get a hold instead.

Books are in order by the number in their title ("Volume 7", "Book One"), grouped by sub-series.
Where a title has no number of its own, or for a collection, the list shows Libby's number for it
("#3 in series", "1-6 in series"). Audiobooks aren't listed, and a book listed twice (two editions) is listed once: bookhoard borrows
the copy with an EPUB or PDF, so you can download it. On a search results page nothing starts
checked, since the results can be anything that matched; a book's series is the better place to
start.

Some series come in editions that overlap, like Saga's volumes (6 issues each), books (18) and
compendium (54). Then the list groups them by edition, shortest at the top and longest at the
bottom, each in number order. Only the shortest edition starts checked, so you don't borrow the
same issues twice; a button for each edition (like **Volumes** or **Books**) picks that one instead.

![The Borrow list for a series, with a checkbox for each book](docs/borrow.png)

bookhoard uses whichever of your libraries has a copy now, including through Libby's partner
libraries (the "lending partnership" screen). If a library card needs verifying, is at its loan
limit, or Libby is refusing it for now ("You appear to have borrowed and returned too many titles
within a short period"), bookhoard leaves that card alone for the rest of the run and tries your
other libraries. Libby's "too many titles" refusal can last days, so bookhoard remembers it for a
day, in every tab, and doesn't try that card for a loan meanwhile. If none of them can lend the book,
it skips it and says why; sort the card out in
Libby and run Borrow again for the rest.

If you already had one of the books on hold and bookhoard borrows it somewhere else, it cancels
that hold, so Libby doesn't lend you a second copy later.

Books you've borrowed before (Libby's card says so, like "Borrowed 22 Apr") start unchecked, labeled
with when; **Borrowed before** checks them too, if you want any again.

Books none of your libraries have are listed as "not at your libraries". Check them (or click
**Notify me**) and bookhoard tags them with Libby's Notify Me, so Libby tells you if a library gets
one.

## The progress panel

While bookhoard works, a panel in the corner shows how far it has got, like
**Returning… 10 of 50: 10 returned, 0 not returned**.

- Problems are listed first, with the reason (often Libby's own message), then the books that
  worked. The list scrolls.
- **Pause** holds bookhoard where it is, and **Resume** carries on. **Stop** stops after the step
  it's on.
- When the run finishes, the panel closes after a few seconds (you can change how long in the
  options). It stays open if something went wrong, while your pointer is over it, and while you're
  in another tab or window.

## Options

Click the bookhoard icon in your browser's toolbar.

![The options page](docs/options.png)

- **File names**: how downloads are named, from fields like title, author, series and number in
  series. `/` makes folders.
- **Save in**: a folder inside your Downloads folder.
- **Format**: EPUB or PDF first, or EPUB only. **If the file already exists**: keep both, or
  replace it.
- **Pause … seconds after every … books**: the downloads' break. 0 turns it off.
- **Buttons in Libby**: one bookhoard button with a menu, or separate buttons.
- **Open in reader**: one book at a time, or all at once.
- **Progress panel**: how many seconds it stays after a run. 0 keeps it open.
- **Troubleshooting**: **Copy last log**, and **Detailed log** for every step of every book.

## Good to know

- In any list of books, Shift-click to check or uncheck every book between two you click.
- Choosing EPUB or PDF locks that loan to the format until you borrow the book again. That's
  how Libby works.
- bookhoard remembers what it has downloaded, even after you move the files, and which books have
  no EPUB or PDF, so those start unchecked next time.
- Keep the Libby tab showing while bookhoard works. Browsers pause tabs in the background, so
  bookhoard waits and carries on when you come back. Its own window works, if you want to use
  other tabs meanwhile.
- After updating bookhoard, reload your Libby tab. Until you do, its old buttons ask you to.

## Something not working?

Click **Copy log** on the panel (or **Copy last log** in the options, once the panel has closed)
and paste it into a [new issue](https://github.com/phillram/bookhoard/issues). It lists your book
titles and what happened to each one, but not your download links. Problems come first, with the
steps that led to each one. For every step of every book, check **Detailed log** in the options and
run it again.

## License

MIT
