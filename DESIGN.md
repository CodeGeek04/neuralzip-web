# Design system

## Scene and theme

A person at a laptop in daylight drops a document onto a focused utility, reads its contents and checks the result. Use a light, ink-on-paper workspace with clear native controls.

## Color strategy

Restrained. Cool tinted paper and graphite carry the interface; a warm vermilion accent marks primary actions. Semantic success and error each include text and an icon.

## Tokens

Paper: oklch(98.5% 0.004 260). Raised surface: oklch(99.7% 0.002 260). Inset surface: oklch(96% 0.006 260). Ink: oklch(24% 0.018 260). Secondary ink: oklch(47% 0.016 260). Border: oklch(88% 0.009 260). Accent: oklch(54% 0.20 32). Accent hover: oklch(48% 0.19 32).

## Typography

Use the native system sans family for the application. Large introductory type at 48px on desktop and 34px on mobile. Body copy 16px. Controls 15–16px. Use a system mono family for filenames, bytes, commands and decoded text. Keep explanatory copy under 70 characters per line.

## Layout and components

An editorial masthead, compact introduction and a generous workbench. Encode and Decode form a segmented control. A source switch offers upload, pasted text and curated samples. Decode offers a book library and an optional live reader. Show progress inline, actual decoded chunks in the reader, then a verified receipt and download. Pause controls apply backpressure to decoding; previews remain bounded while downloads retain all bytes. Installation and technical details sit below the utility. Use borders to separate functional regions; avoid nested cards.

## Interaction

Controls have visible focus, hover, active, disabled and busy states. Use 160–220ms opacity and transform transitions. Respect reduced motion. Error messages remain next to the task and provide a next action. Success is useful: show verification and the download, with no confetti.
