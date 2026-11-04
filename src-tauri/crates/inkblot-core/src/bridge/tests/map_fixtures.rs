//! A map's chrome for the bridge tests: one of every kind of panel field, so each is
//! on the wire at least once (`every_event` in `fixtures.rs` carries it).

use super::*;

pub(super) fn map_button(id: &str, label: &str) -> MapPanelButton {
    MapPanelButton {
        id: id.into(),
        label: label.into(),
        role: MapButtonRole::Normal,
        disabled: false,
        icon: None,
        help: None,
    }
}

/// A map's chrome with one of every kind of field, so each is on the wire at least once.
pub(super) fn map_chrome() -> MapChromeState {
    let fields = vec![
        MapPanelField::Text(MapTextInput {
            id: "pin.name".into(),
            label: "Name".into(),
            value: "Harrowgate".into(),
            placeholder: None,
            multiline: false,
            focus_key: 0,
        }),
        MapPanelField::Number(MapNumberInput {
            id: "route.width".into(),
            label: "Width".into(),
            value: Some(2.5),
            min: Some(0.5),
            max: Some(20.0),
            step: Some(0.5),
            suffix: Some("px".into()),
            allow_empty: false,
            help: None,
        }),
        MapPanelField::Choice(MapChoiceInput {
            id: "route.dash".into(),
            label: "Style".into(),
            value: "solid".into(),
            options: vec![MapChoice {
                value: "solid".into(),
                label: "Solid".into(),
                group: None,
            }],
            help: None,
        }),
        MapPanelField::Toggle(MapToggleInput {
            id: "route.arrow".into(),
            label: "Arrow at end".into(),
            value: false,
        }),
        MapPanelField::Color(MapColorInput {
            id: "pin.color".into(),
            label: "Colour".into(),
            value: None,
            fallback: "#c0392b".into(),
        }),
        MapPanelField::Stat(MapStatRow {
            label: "Length".into(),
            value: "42 km".into(),
            action: None,
        }),
        MapPanelField::Note(MapNoteText {
            text: "Tip".into(),
            tone: MapNoteTone::Warning,
            swatch: None,
            action: None,
        }),
        MapPanelField::Button(map_button("pin.open", "Open")),
        MapPanelField::Buttons(MapButtonRow {
            buttons: vec![map_button("theme.clean", "Clean")],
        }),
        MapPanelField::ListRow(MapListRow {
            id: "places.p1".into(),
            title: "Harrowgate".into(),
            subtitle: None,
            swatch: None,
            indent: 0,
        }),
        MapPanelField::Markers(MapMarkerInput {
            id: "pin.icon".into(),
            value: "city".into(),
            color: None,
            options: vec![MapChoice {
                value: "city".into(),
                label: "City".into(),
                group: None,
            }],
        }),
        MapPanelField::Date(MapDateInput {
            id: "traveler.startDay".into(),
            label: "On".into(),
            value: Some(MapDateParts {
                year: 1850.0,
                month: 3.0,
                day: 1.0,
                hour: 9.0,
                minute: 30.0,
            }),
            mode: MapCalendarMode::Gregorian,
            months: vec!["January".into()],
            allow_empty: false,
            placeholder: None,
        }),
        MapPanelField::Table(MapTableView {
            columns: vec!["Harrowgate".into()],
            rows: vec![MapTableRowView {
                label: "Harrowgate".into(),
                cells: vec![MapTableCell {
                    text: "—".into(),
                    detail: None,
                    strong: false,
                }],
            }],
        }),
        MapPanelField::Preview(MapShapePreview {
            width: 100.0,
            height: 50.0,
            path: "M0 0L10 10Z".into(),
            filled: true,
        }),
        MapPanelField::Group(MapPanelGroup {
            id: "leg.l1".into(),
            title: "Leg 1".into(),
            swatch: None,
            actions: vec![map_button("leg.l1.remove", "×")],
            fields: vec![],
            collapsible: false,
        }),
    ];
    MapChromeState {
        surface_id: "map-surface-0".into(),
        doc_path: "World.map".into(),
        tool: MapTool::Pin,
        zoom: 2.5,
        zoom_label: "250%".into(),
        can_undo: true,
        can_redo: false,
        has_selection: true,
        panel: MapPanel {
            title: "Place".into(),
            can_go_back: true,
            problems: 0,
            tabs: vec![],
            tab: None,
            sections: vec![MapPanelSection {
                id: "place".into(),
                title: "Place".into(),
                actions: vec![],
                fields,
            }],
        },
        reveal_panel: 1,
        active: true,
        map_kind: Some(crate::types::map::MapKind::Earth),
        view_menu: vec![MapMenuItem {
            id: "earth.view.globe".into(),
            label: "Globe".into(),
            checked: true,
            disabled: false,
            separator: false,
        }],
    }
}
