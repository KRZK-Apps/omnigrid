# @omnigrid/mint-theme

A mint-green color theme for OmniGrid with both light and dark palettes. The
palette changes with the existing `.dark` class; the theme itself is the table's
color style, not a light/dark mode switch. SelectionPlugin checkboxes use
matching mint accents in both modes.

## Install and use

```sh
npm install @omnigrid/mint-theme
```

Import the theme stylesheet in your application after importing
`@omnigrid/react`:

```ts
import "@omnigrid/react";
import "@omnigrid/mint-theme";
```

The React adapter includes `@omnigrid/default-theme` by default. This theme
overrides its color variables, including when a framework emits layout CSS
before the adapter's page CSS. Keep the default theme dependency installed; the
mint package only replaces the palette and does not include structural styles.

## License

MIT © KRZK Apps
