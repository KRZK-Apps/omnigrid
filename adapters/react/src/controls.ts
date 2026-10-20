import type { ChangeEvent, KeyboardEvent, ReactNode } from "react";
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { UIControlDescriptor, UIInputControl, UIMultiSelectControl, UISelectControl } from "@omnigrid/core";

const CONTROL_TYPES: ReadonlySet<string> = new Set(["text", "number", "date", "select", "checkbox", "button", "label", "multi-select", "group"]);

/** Type guard for core `UIControlDescriptor` objects. */
export function isUIControlDescriptor(value: unknown): value is UIControlDescriptor {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as { type?: unknown; id?: unknown };
    return typeof candidate.type === "string" && CONTROL_TYPES.has(candidate.type) && typeof candidate.id === "string";
}

const DEFAULT_DEBOUNCE_MS: number = 250;

export interface DebouncedInputProps {
    descriptor: UIInputControl;
}

/**
 * Text/number input that keeps typing in local state and forwards the value to
 * the descriptor callback after `debounceMs` of inactivity. Pending input is
 * flushed on Enter, blur and unmount so it is never lost.
 */
export function DebouncedInput({ descriptor }: DebouncedInputProps): ReactNode {
    const [local, setLocal] = useState<string>(descriptor.value);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingRef = useRef<string | null>(null);
    const onChangeRef = useRef<(value: string) => void>(descriptor.onChange);
    onChangeRef.current = descriptor.onChange;

    const flush = (): void => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        if (pendingRef.current !== null) {
            const value: string = pendingRef.current;
            pendingRef.current = null;
            onChangeRef.current(value);
        }
    };

    // Adopt external value changes (e.g. clearFilters) unless the user has unsent input.
    useEffect(() => {
        if (pendingRef.current === null) setLocal(descriptor.value);
    }, [descriptor.value]);

    useEffect(() => flush, []);

    const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
        const next: string = event.target.value;
        setLocal(next);
        pendingRef.current = next;
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(flush, descriptor.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.key === "Enter") {
            descriptor.onEnter?.();
            flush();
        }
    };

    const handleClear = (): void => {
        setLocal("");
        pendingRef.current = "";
        flush();
    };

    return createElement(
        "div",
        { className: "omnigrid-control-input-wrapper" },
        createElement("input", {
            className: ["omnigrid-control-input", descriptor.className].filter(Boolean).join(" "),
            type: descriptor.type === "number" ? "number" : descriptor.type === "date" ? "date" : "text",
            value: local,
            placeholder: descriptor.placeholder,
            disabled: descriptor.disabled,
            "aria-label": descriptor.ariaLabel ?? descriptor.label ?? descriptor.placeholder,
            onChange: handleChange,
            onBlur: flush,
            onKeyDown: handleKeyDown,
        }),
        local.length > 0 &&
            createElement("button", {
                type: "button",
                className: "omnigrid-control-clear",
                "aria-label": "Clear",
                onClick: handleClear,
            },
            "×"),
    );
}

function withLabel(descriptor: UIControlDescriptor, field: ReactNode, inline: boolean = false, resolveIcon?: (name: string) => ReactNode): ReactNode {
    const className: string = ["omnigrid-control", `omnigrid-control-${descriptor.type}`].join(" ");
    const icon: ReactNode = descriptor.icon && resolveIcon ? resolveIcon(descriptor.icon) : null;
    const body: ReactNode = icon ? createElement("div", { className: "omnigrid-control-body" }, icon, field) : field;
    if (!descriptor.label) return createElement("div", { key: descriptor.id, className }, body);
    const label: ReactNode = createElement("span", { className: "omnigrid-control-label" }, descriptor.label);
    return inline ? createElement("label", { key: descriptor.id, className }, body, label) : createElement("label", { key: descriptor.id, className }, label, body);
}

/**
 * Custom-styled, keyboard-navigable drop-down select. Replaces the native
 * `<select>` so the control looks identical in light and dark themes and can
 * be fully styled through CSS variables.
 */
function SelectControl({ descriptor }: { descriptor: UISelectControl }): ReactNode {
    const [isOpen, setIsOpen] = useState<boolean>(false);
    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
    const [anchorRect, setAnchorRect] = useState<{ x: number; y: number; width: number } | null>(null);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const listboxRef = useRef<HTMLDivElement | null>(null);

    const selectedIndex: number = useMemo(
        (): number => descriptor.options.findIndex((option) => option.value === descriptor.value),
        [descriptor.options, descriptor.value],
    );

    const listboxId: string = `${descriptor.id}-listbox`;

    useEffect(() => {
        if (!isOpen) {
            setFocusedIndex(null);
            setAnchorRect(null);
            return;
        }
        const rect: DOMRect | null = buttonRef.current ? buttonRef.current.getBoundingClientRect() : null;
        if (rect) {
            setAnchorRect({ x: rect.left, y: rect.bottom, width: rect.width });
        }
        setFocusedIndex(selectedIndex === -1 ? 0 : selectedIndex);
    }, [isOpen, selectedIndex]);

    const close: () => void = useCallback((): void => {
        setIsOpen(false);
        setFocusedIndex(null);
        setAnchorRect(null);
        buttonRef.current?.focus();
    }, []);

    const selectOption: (index: number) => void = useCallback(
        (index: number): void => {
            const option: UISelectControl["options"][number] | undefined = descriptor.options[index];
            if (!option || option.disabled) return;
            descriptor.onChange(option.value);
            close();
        },
        [descriptor, close],
    );

    const moveFocus: (delta: number) => void = useCallback(
        (delta: number): void => {
            if (focusedIndex === null) {
                setFocusedIndex(0);
                return;
            }
            const length: number = descriptor.options.length;
            let next: number = focusedIndex + delta;
            while (next >= 0 && next < length && descriptor.options[next]?.disabled) {
                next += delta;
            }
            if (next >= 0 && next < length) setFocusedIndex(next);
        },
        [descriptor.options, focusedIndex],
    );

    const handleButtonKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void = useCallback(
        (event: KeyboardEvent<HTMLButtonElement>): void => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setIsOpen(true);
            }
        },
        [],
    );

    const handleListboxKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void = useCallback(
        (event: KeyboardEvent<HTMLDivElement>): void => {
            switch (event.key) {
                case "ArrowDown":
                    event.preventDefault();
                    moveFocus(1);
                    break;
                case "ArrowUp":
                    event.preventDefault();
                    moveFocus(-1);
                    break;
                case "Home":
                    event.preventDefault();
                    setFocusedIndex(0);
                    break;
                case "End":
                    event.preventDefault();
                    setFocusedIndex(descriptor.options.length - 1);
                    break;
                case "Enter":
                    event.preventDefault();
                    if (focusedIndex !== null) selectOption(focusedIndex);
                    break;
                case "Escape":
                    event.preventDefault();
                    close();
                    break;
            }
        },
        [descriptor.options.length, focusedIndex, moveFocus, selectOption, close],
    );

    useEffect(() => {
        if (!isOpen) return;
        const handlePointerDown = (event: MouseEvent): void => {
            const target: Node | null = event.target as Node | null;
            if (
                buttonRef.current &&
                !buttonRef.current.contains(target) &&
                listboxRef.current &&
                !listboxRef.current.contains(target)
            ) {
                close();
            }
        };
        document.addEventListener("mousedown", handlePointerDown);
        return (): void => {
            document.removeEventListener("mousedown", handlePointerDown);
        };
    }, [isOpen, close]);

    // Keep the portaled listbox anchored to the trigger while anything scrolls.
    useEffect(() => {
        if (!isOpen || !anchorRect) return;
        const reposition = (): void => {
            const rect: DOMRect | null = buttonRef.current ? buttonRef.current.getBoundingClientRect() : null;
            if (rect) setAnchorRect({ x: rect.left, y: rect.bottom, width: rect.width });
        };
        const targets: EventTarget[] = [window];
        let node: HTMLElement | null = buttonRef.current;
        while (node && node !== document.body) {
            const style: CSSStyleDeclaration = window.getComputedStyle(node);
            if (style.overflowY === "auto" || style.overflowY === "scroll" || style.overflow === "auto" || style.overflow === "scroll") {
                targets.push(node);
            }
            node = node.parentElement;
        }
        targets.forEach((target: EventTarget): void => {
            target.addEventListener("scroll", reposition, { passive: true });
        });
        window.addEventListener("resize", reposition);
        return (): void => {
            targets.forEach((target: EventTarget): void => {
                target.removeEventListener("scroll", reposition);
            });
            window.removeEventListener("resize", reposition);
        };
    }, [isOpen, anchorRect]);

    const currentOption: UISelectControl["options"][number] | undefined = descriptor.options[selectedIndex === -1 ? 0 : selectedIndex];
    const label: string = currentOption ? currentOption.label : descriptor.value;

    const listbox: ReactNode | null = (
        anchorRect &&
        isOpen &&
        createPortal(
            createElement(
                "div",
                {
                    ref: listboxRef,
                    id: listboxId,
                    role: "listbox",
                    "aria-label": descriptor.ariaLabel ?? descriptor.label,
                    "data-omnigrid-filter-trigger": "",
                    className: "omnigrid-select-listbox",
                    onKeyDown: handleListboxKeyDown,
                    onClick: (event): void => {
                        event.stopPropagation();
                    },
                    style: {
                        left: `${anchorRect.x}px`,
                        top: `${anchorRect.y}px`,
                        minWidth: `${anchorRect.width}px`,
                    },
                },
                descriptor.options.map((option, index) => {
                    const selected: boolean = option.value === descriptor.value;
                    const focused: boolean = focusedIndex === index;
                    return createElement(
                        "div",
                        {
                            key: option.value,
                            role: "option",
                            "aria-selected": selected,
                            tabIndex: focused ? 0 : -1,
                            "aria-disabled": option.disabled || undefined,
                            className: [
                                "omnigrid-select-option",
                                focused ? "omnigrid-select-option-focused" : null,
                                selected ? "omnigrid-select-option-selected" : null,
                                option.disabled ? "omnigrid-select-option-disabled" : null,
                            ]
                                .filter(Boolean)
                                .join(" "),
                            onClick: (): void => selectOption(index),
                            onKeyDown: (event: KeyboardEvent<HTMLDivElement>): void => handleListboxKeyDown(event),
                        },
                        option.label,
                    );
                }),
            ),
            document.body,
        )
    );

    return createElement(
        "div",
        {
            className: ["omnigrid-select-wrapper", descriptor.className].filter(Boolean).join(" "),
        },
        createElement(
            "button",
            {
                ref: buttonRef,
                type: "button",
                role: "button",
                "aria-haspopup": "listbox",
                "aria-expanded": isOpen,
                "aria-controls": listboxId,
                "aria-label": descriptor.ariaLabel ?? descriptor.label,
                className: ["omnigrid-select-button", descriptor.disabled ? "omnigrid-select-button-disabled" : null]
                    .filter(Boolean)
                    .join(" "),
                disabled: descriptor.disabled,
                onClick: (event): void => {
                    event.stopPropagation();
                    setIsOpen((previous: boolean) => !previous);
                },
                onKeyDown: handleButtonKeyDown,
            },
            createElement("span", { className: "omnigrid-select-value" }, label),
            createElement("span", { className: "omnigrid-select-arrow", "aria-hidden": "true" }, "▼"),
        ),
        listbox,
    );
}

/**
 * Custom-styled, searchable multi-select listbox with checkboxes for set/category filtering.
 */
function MultiSelectControl({ descriptor }: { descriptor: UIMultiSelectControl }): ReactNode {
    const [searchTerm, setSearchTerm] = useState<string>("");

    const filteredOptions = useMemo(() => {
        if (!searchTerm.trim()) return descriptor.options;
        const term = searchTerm.toLowerCase();
        return descriptor.options.filter(
            (opt) => opt.label.toLowerCase().includes(term) || opt.value.toLowerCase().includes(term),
        );
    }, [descriptor.options, searchTerm]);

    const allChecked = useMemo(
        () => descriptor.options.length > 0 && descriptor.options.every((opt) => opt.checked),
        [descriptor.options],
    );

    const someChecked = useMemo(
        () => descriptor.options.length > 0 && !allChecked && descriptor.options.some((opt) => opt.checked),
        [descriptor.options, allChecked],
    );

    const selectAllRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (selectAllRef.current) {
            selectAllRef.current.indeterminate = someChecked;
        }
    }, [someChecked]);

    const toggleAll = (checked: boolean) => {
        if (checked) {
            descriptor.onChange(descriptor.options.map((opt) => opt.value));
        } else {
            descriptor.onChange([]);
        }
    };

    const toggleOption = (val: string, checked: boolean) => {
        const currentlyChecked = new Set(
            descriptor.options.filter((opt) => opt.checked).map((opt) => opt.value),
        );
        if (checked) {
            currentlyChecked.add(val);
        } else {
            currentlyChecked.delete(val);
        }
        descriptor.onChange(Array.from(currentlyChecked));
    };

    return createElement(
        "div",
        { className: ["omnigrid-multi-select-container", descriptor.className].filter(Boolean).join(" ") },
        createElement(
            "div",
            { className: "omnigrid-control-input-wrapper" },
            createElement("input", {
                className: "omnigrid-control-input",
                type: "text",
                placeholder: descriptor.searchPlaceholder ?? "Search...",
                value: searchTerm,
                onChange: (e: ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value),
                onClick: (e: React.MouseEvent) => e.stopPropagation(),
            }),
            searchTerm.length > 0 &&
                createElement(
                    "button",
                    {
                        type: "button",
                        className: "omnigrid-control-clear",
                        "aria-label": "Clear search",
                        onClick: (e: React.MouseEvent) => {
                            e.stopPropagation();
                            setSearchTerm("");
                        },
                    },
                    "×",
                ),
        ),
        createElement(
            "div",
            { className: "omnigrid-multi-select-actions" },
            createElement(
                "label",
                { className: "omnigrid-multi-select-item" },
                createElement("input", {
                    ref: selectAllRef,
                    type: "checkbox",
                    className: "omnigrid-checkbox",
                    checked: allChecked,
                    onChange: (e: ChangeEvent<HTMLInputElement>) => toggleAll(e.target.checked),
                }),
                createElement("span", { className: "omnigrid-multi-select-label" }, "(Select all)"),
            ),
        ),
        createElement(
            "div",
            { className: "omnigrid-multi-select-list" },
            filteredOptions.map((option) =>
                createElement(
                    "label",
                    { key: option.value, className: "omnigrid-multi-select-item" },
                    createElement("input", {
                        type: "checkbox",
                        className: "omnigrid-checkbox",
                        checked: option.checked,
                        onChange: (e: ChangeEvent<HTMLInputElement>) => toggleOption(option.value, e.target.checked),
                    }),
                    createElement("span", { className: "omnigrid-multi-select-label" }, option.label),
                ),
            ),
        ),
    );
}

/**
 * Renders one framework-agnostic control descriptor with native HTML elements.
 * Descriptor `id`s become React keys, so re-describing a popup updates
 * elements in place instead of remounting them.
 * @param descriptor - Control descriptor to materialise.
 * @param resolveIcon - Optional resolver mapping `descriptor.icon` names to nodes; backed by the grid icon registry.
 */
export function renderControl(descriptor: UIControlDescriptor, resolveIcon?: (name: string) => ReactNode): ReactNode {
    switch (descriptor.type) {
        case "text":
        case "number":
        case "date":
            return withLabel(descriptor, createElement(DebouncedInput, { descriptor }), false, resolveIcon);
        case "select":
            return withLabel(descriptor, createElement(SelectControl, { descriptor }), false, resolveIcon);
        case "multi-select":
            return withLabel(descriptor, createElement(MultiSelectControl, { descriptor }), false, resolveIcon);
        case "checkbox":
            return withLabel(
                descriptor,
                createElement("input", {
                    type: "checkbox",
                    className: ["omnigrid-checkbox", descriptor.className].filter(Boolean).join(" "),
                    checked: descriptor.checked,
                    disabled: descriptor.disabled,
                    onChange: (event: ChangeEvent<HTMLInputElement>) => descriptor.onChange(event.target.checked),
                }),
                true,
                resolveIcon,
            );
        case "button":
            return createElement(
                "button",
                {
                    key: descriptor.id,
                    type: "button",
                    className: ["omnigrid-control-button", descriptor.variant === "primary" ? "omnigrid-control-button-primary" : null, descriptor.className]
                        .filter(Boolean)
                        .join(" "),
                    disabled: descriptor.disabled,
                    onClick: () => descriptor.onClick(),
                },
                descriptor.text,
            );
        case "label":
            return createElement("div", { key: descriptor.id, className: ["omnigrid-control-label", descriptor.className].filter(Boolean).join(" ") }, descriptor.text);
        case "group":
            return createElement(
                "div",
                {
                    key: descriptor.id,
                    className: ["omnigrid-control", "omnigrid-control-group", descriptor.direction === "row" ? "omnigrid-control-group-row" : null, descriptor.className]
                        .filter(Boolean)
                        .join(" "),
                },
                descriptor.children.map((child) => renderControl(child, resolveIcon)),
            );
        default:
            return null;
    }
}
