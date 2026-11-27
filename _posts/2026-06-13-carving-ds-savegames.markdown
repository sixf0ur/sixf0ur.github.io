---
layout: post
title:  "Carving Nintendo DS savegames out of a corrupted flashcart image"
date:   2026-06-13 12:00:00 +0200
categories:
tags: [Forensics, Python, Nintendo DS]
description: "The file table was gone, the bytes were not. How an 8-byte file and a byte pattern search got my saves back out of a raw card image."
image: /assets/savegames/cover.png
---

# Carving Nintendo DS savegames out of a corrupted flashcart image

Earlier this year I had an incident with my Nintendo DS flashcart. The card in it
got corrupted, and with it every savegame I had on there. The filesystem was
gone, but the data was not: a raw dump of the card still gave me a `.bin` image
with all the bytes in it. They just had no names, no folders and no file table
saying where anything started or ended.

This post is about how I got the saves back out of that blob with a small Python
script, and why an 8-byte file was the most useful thing I had.

## What I had

**The image.** One big `.bin` dump of the card. Somewhere in there: savegames,
pieces of other files, erased areas full of `0xFF`, and whatever else the corruption
left behind. All of it is just one long run of bytes without any addresses that
mean something.

The good news is that a DS save is a very simple file. The flashcart mirrors the
game's save chip into a `.sav` file, byte for byte, with no container around it.
So if a save survived somewhere in the image, it survived as one contiguous
block of bytes. (That holds as long as the file was not fragmented on the card,
which for a 512 KB file that is written in place is usually the case.)

**A reference save that was only 8 bytes long.** The only copy of my
*New Super Mario Bros.* save on my PC was a file called `New Super Mario Bros.sav`,
and for whatever reason it was 8 bytes in size. Useless as a save. But those
8 bytes are the first 8 bytes of a real one, and that turned out to be all I
needed.

A quick hex dump:

```python
def hexdump(data, width=16):
    for i in range(0, len(data), width):
        chunk = data[i:i + width]
        hex_part = " ".join(f"{b:02X}" for b in chunk).ljust(width * 3)
        text = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
        print(f"{i:08X}  {hex_part} |{text}|")

with open("New Super Mario Bros.sav", "rb") as f:
    hexdump(f.read())
```

```
00000000  B0 29 4D 61 72 69 6F 32                          |.)Mario2|
```

`B0 29`, followed by the ASCII string `Mario2`. That is the header the game puts
at the very start of its save data.

## The idea

If every NSMB save starts with these 8 bytes, I don't need the filesystem at all:

1. Search the whole image for `B0 29 4D 61 72 69 6F 32`.
2. Every hit is the start of a candidate save.
3. The size is fixed: an NSMB save is 512 KB, 524,288 bytes. So from each hit I
   take the pattern plus the bytes that follow it, until the file is 512 KB long,
   and write that out as its own `.sav`.

This is plain file carving, just with a known header and a known size instead of
a header and a footer. The interactive figure below shows what happens to the
image in each step.

{% include carve-viz.html %}

## Finding every hit

The search is basically a regex over raw bytes, except the pattern is a fixed
string, so `bytes.find()` is enough:

```python
def find_offsets(data: bytes, pattern: bytes) -> list[int]:
    offsets = []
    pos = data.find(pattern)
    while pos != -1:
        offsets.append(pos)
        pos = data.find(pattern, pos + 1)   # +1, not +len(pattern)
    return offsets
```

Two details matter here. First, the search continues from `pos + 1`, so it really
checks every single byte offset in the image. On an intact card a file starts on
a sector boundary and you could step in 512-byte jumps, but in a damaged image I
didn't want to rely on that. Second, it collects *all* hits, not just the first
one. There can be more than one copy of the same save in an image: older versions
in freed sectors or backup copies. Each one gets its own file.

If you prefer regex, this is the same thing. The lookahead makes overlapping
matches show up too:

```python
import re

offsets = [m.start() for m in re.finditer(b"(?=" + re.escape(pattern) + b")", data)]
```

I started with only the first four bytes (`B0294D61`), but the full eight bytes
are the better choice. Every extra byte makes a random false hit in unrelated
data much less likely.

## Cutting out the saves

Once the offsets are known, extracting is a slice per hit:

```python
from pathlib import Path

SAVE_SIZE = 512 * 1024   # 524,288 bytes

def carve(image_path, pattern_hex, out_dir="extracted_savegames"):
    pattern = bytes.fromhex(pattern_hex.replace(" ", ""))
    data = Path(image_path).read_bytes()
    after = SAVE_SIZE - len(pattern)          # 524,280 for an 8-byte pattern

    Path(out_dir).mkdir(exist_ok=True)
    for i, off in enumerate(find_offsets(data, pattern), 1):
        end = off + len(pattern) + after
        if end > len(data):
            left = len(data) - off - len(pattern)
            print(f"hit {i} at 0x{off:08X}: only {left:,} bytes left, skipped")
            continue
        out = Path(out_dir) / f"savegame_{i:03d}_offset_0x{off:08X}.sav"
        out.write_bytes(data[off:end])
        print(f"hit {i} at 0x{off:08X} -> {out.name}")
```

```
python savegame_extractor.py card.bin B0294D6172696F32
```

Every file is named after the offset where its pattern was found, so I can always
map a carved save back to its position in the image.

**The off-by-eight.** My first version took the pattern and then a full
524,288 bytes after it. Every file came out at 524,296 bytes, eight too many,
and a save that is not exactly 512 KB is not something you want to hand to an
emulator or a flashcart. The fix is the `after` line above: take
`SAVE_SIZE - len(pattern)` bytes after the pattern, so pattern plus tail is
exactly 524,288. That is the "+ 524,280 bytes" step in the figure.

A hit too close to the end of the image can't hold a full save. Those are
reported and skipped instead of being written out as a short file.

## Checking the results

A hit is a candidate, not a guaranteed save. What I looked at:

- **Work on a copy.** The script only reads the image, but a corrupted card is
  the one thing you can't afford to damage further.
- **Where the hits are.** Hits on sector boundaries, or exactly 512 KB apart,
  look like real files. A hit at a random offset in the middle of unrelated data is
  more suspicious.
- **Duplicates.** Several hits can be byte-identical copies. Hashing the
  carved files sorts those out quickly.
- **The real test.** Load the save in an emulator and see if the game accepts
  it and shows the progress you remember.

## Takeaways

A lost file table is not the same as lost data. As long as you know what the
start of a file looks like and how long it is, you can pull it out of a raw
image without understanding anything else about the disk. In my case all the
knowledge I needed was in a broken 8-byte file.

And: back up your saves somewhere that is not the card they live on.
