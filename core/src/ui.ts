/**
 * Framework-agnostic UI descriptors. Plugins describe interactive panels
 * declaratively; adapters (React, Vue, ...) materialise them. Descriptors are
 * plain data plus callbacks — no framework types.
 */

/** Option of a select control. @api */
export interface UISelectOption {
    /** Value passed to `onChange` when the option is chosen. */
    value: string;
    /** Human-readable option label. */
    label: string;
    /** Disables the option. @default false */
    disabled?: boolean;
}

/** Properties shared by every control descriptor. @api */
export interface UIControlBase {
    /** Stable identifier; adapters use it as the element key. */
    id: string;
    /** Visible label rendered next to the control. */
    label?: string;
    /** Disables the control. @default false */
    disabled?: boolean;
    /** Extra CSS class names. */
    className?: string;
}

/** Single-line text, number or date input. @api */
export interface UIInputControl extends UIControlBase {
    type: "text" | "number" | "date";
    /** Current value. */
    value: string;
    /** Placeholder text. */
    placeholder?: string;
    /** Debounce applied by the adapter before `onChange` fires. @default 250 */
    debounceMs?: number;
    /** Called with the (debounced) new value. */
    onChange: (value: string) => void;
    /** Called when the user presses Enter while the input is focused. */
    onEnter?: () => void;
}

/** Drop-down select. @api */
export interface UISelectControl extends UIControlBase {
    type: "select";
    /** Currently selected option value. */
    value: string;
    /** Available options. */
    options: UISelectOption[];
    /** Called with the newly selected value. */
    onChange: (value: string) => void;
}

/** Checkbox. @api */
export interface UICheckboxDescriptor extends UIControlBase {
    type: "checkbox";
    /** Current checked state. */
    checked: boolean;
    /** Called with the new checked state. */
    onChange: (checked: boolean) => void;
}

/** Push button. @api */
export interface UIButtonControl extends UIControlBase {
    type: "button";
    /** Button caption. */
    text: string;
    /** Visual emphasis. @default "secondary" */
    variant?: "primary" | "secondary";
    /** Called when the button is clicked. */
    onClick: () => void;
}

/** Static text. @api */
export interface UITextBlockControl extends UIControlBase {
    type: "label";
    /** Text to display. */
    text: string;
}

/** Option for a multi-select set control. @api */
export interface UIMultiSelectOption {
    /** Value of the item. */
    value: string;
    /** Human-readable label. */
    label: string;
    /** Whether this item is currently selected. */
    checked: boolean;
}

/** Searchable checklist / set filter control. @api */
export interface UIMultiSelectControl extends UIControlBase {
    type: "multi-select";
    /** Available options with checked state. */
    options: UIMultiSelectOption[];
    /** Placeholder for the search input. @default "Search..." */
    searchPlaceholder?: string;
    /** Called when the selected set changes. */
    onChange: (selectedValues: string[]) => void;
}

/** Container laying out child controls. @api */
export interface UIGroupControl extends UIControlBase {
    type: "group";
    /** Layout direction. @default "column" */
    direction?: "row" | "column";
    /** Nested controls. */
    children: UIControlDescriptor[];
}

/** Any declarative control. @api */
export type UIControlDescriptor =
    | UIInputControl
    | UISelectControl
    | UICheckboxDescriptor
    | UIButtonControl
    | UITextBlockControl
    | UIMultiSelectControl
    | UIGroupControl;

/** Viewport-relative anchor rectangle (CSS pixels) a popup is positioned against. @api */
export interface UIPopupAnchor {
    x: number;
    y: number;
    width?: number;
    height?: number;
}

/** Declarative floating panel. @api */
export interface UIPopupDescriptor {
    /** Stable identifier. Re-opening a popup with the same id updates it in place. */
    id: string;
    /** Optional heading. */
    title?: string;
    /** Rectangle the popup is attached to; centered in the grid when omitted. */
    anchor?: UIPopupAnchor;
    /** Placement relative to the anchor. @default "bottom-start" */
    placement?: "bottom-start" | "bottom-end";
    /** Popup body. */
    controls: UIControlDescriptor[];
    /** Close when the user clicks outside. @default true */
    closeOnOutsideClick?: boolean;
    /** Close on Escape. @default true */
    closeOnEscape?: boolean;
    /** Extra CSS class names. */
    className?: string;
    /** Invoked after the popup has been closed. */
    onClose?: () => void;
}

/**
 * Holds the single active popup and notifies the adapter on change.
 * @internal
 */
export class PopupManager {
    private current: UIPopupDescriptor | null = null;

    public constructor(private readonly onChange: (popup: UIPopupDescriptor | null) => void) {}

    public open(descriptor: UIPopupDescriptor): void {
        const previous: UIPopupDescriptor | null = this.current;
        this.current = descriptor;
        if (previous && previous.id !== descriptor.id) previous.onClose?.();
        this.onChange(descriptor);
    }

    public close(): void {
        const previous: UIPopupDescriptor | null = this.current;
        if (!previous) return;
        this.current = null;
        this.onChange(null);
        previous.onClose?.();
    }

    public get(): UIPopupDescriptor | null {
        return this.current;
    }
}
