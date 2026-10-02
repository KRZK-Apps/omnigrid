# @omnigrid/default-theme

The default OmniGrid color theme. It provides both light colors and a `.dark`
variant, so the same theme works with class-based light/dark mode switches.
It also sets the theme-specific accent color for SelectionPlugin checkboxes.

## Usage

`@omnigrid/react` includes this theme automatically. To use it directly with a
different adapter, import it in your application:

```ts
import "@omnigrid/default-theme";
```

To replace the default palette with another theme, install and import that
theme's package in your application after the React adapter. Theme packages
provide their own light and dark palette overrides.

## License

MIT © KRZK Apps
