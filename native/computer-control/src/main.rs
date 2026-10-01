use std::io::{self, BufRead, Write};
use std::sync::Mutex;

use base64::Engine;
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use image::{DynamicImage, ImageFormat};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use xcap::Monitor;

#[derive(Debug, Deserialize)]
struct Request {
    id: u64,
    action: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct Response {
    id: u64,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn success(id: u64, result: Value) -> Response {
    Response { id, ok: true, result: Some(result), error: None }
}

fn failure(id: u64, error: impl ToString) -> Response {
    Response { id, ok: false, result: None, error: Some(error.to_string()) }
}

fn number(params: &Value, name: &str, default: f64) -> f64 {
    params.get(name).and_then(Value::as_f64).unwrap_or(default)
}

fn string(params: &Value, name: &str) -> String {
    params.get(name).and_then(Value::as_str).unwrap_or("").to_string()
}

fn key_from_name(value: &str) -> Option<Key> {
    let key = value.trim().to_lowercase();
    let key = key.strip_prefix("key:").unwrap_or(&key);
    let result = match key {
        "enter" | "return" => Key::Return,
        "tab" => Key::Tab,
        "escape" | "esc" => Key::Escape,
        "backspace" => Key::Backspace,
        "delete" | "del" => Key::Delete,
        "space" => Key::Space,
        "up" | "arrowup" => Key::UpArrow,
        "down" | "arrowdown" => Key::DownArrow,
        "left" | "arrowleft" => Key::LeftArrow,
        "right" | "arrowright" => Key::RightArrow,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" | "page up" => Key::PageUp,
        "pagedown" | "page down" => Key::PageDown,
        "ctrl" | "control" => Key::Control,
        "shift" => Key::Shift,
        "alt" => Key::Alt,
        "win" | "windows" | "meta" => Key::Meta,
        "f1" => Key::F1,
        "f2" => Key::F2,
        "f3" => Key::F3,
        "f4" => Key::F4,
        "f5" => Key::F5,
        "f6" => Key::F6,
        "f7" => Key::F7,
        "f8" => Key::F8,
        "f9" => Key::F9,
        "f10" => Key::F10,
        "f11" => Key::F11,
        "f12" => Key::F12,
        _ => return key.chars().next().map(Key::Unicode),
    };
    Some(result)
}

fn screenshot(params: &Value) -> Result<Value, String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors
        .into_iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .ok_or_else(|| "No primary monitor was found.".to_string())?;

    let image = monitor.capture_image().map_err(|e| e.to_string())?;
    let width = params.get("width").and_then(Value::as_u64).unwrap_or(1280) as u32;
    let height = params.get("height").and_then(Value::as_u64).unwrap_or(800) as u32;
    let image = if width > 0 && height > 0 && (image.width() != width || image.height() != height) {
        DynamicImage::ImageRgba8(image).resize_exact(width, height, image::imageops::FilterType::Triangle)
    } else {
        DynamicImage::ImageRgba8(image)
    };

    let mut bytes = std::io::Cursor::new(Vec::<u8>::new());
    image.write_to(&mut bytes, ImageFormat::Png).map_err(|e| e.to_string())?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes.into_inner());
    Ok(json!({
        "dataUrl": format!("data:image/png;base64,{}", encoded),
        "width": width,
        "height": height
    }))
}

fn execute(enigo: &Mutex<Enigo>, action: &str, params: &Value) -> Result<Value, String> {
    if action == "SCREENSHOT" {
        return screenshot(params);
    }
    if action == "SHUTDOWN" {
        return Ok(json!({ "shutdown": true }));
    }

    let mut input = enigo.lock().map_err(|_| "Input controller lock poisoned.")?;
    match action {
        "MOVE_MOUSE" => {
            let x = number(params, "x", 0.0) as i32;
            let y = number(params, "y", 0.0) as i32;
            input.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
        }
        "CLICK" => {
            let x = number(params, "x", 0.0) as i32;
            let y = number(params, "y", 0.0) as i32;
            input.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
            input.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
        }
        "RIGHT_CLICK" => {
            let x = number(params, "x", 0.0) as i32;
            let y = number(params, "y", 0.0) as i32;
            input.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
            input.button(Button::Right, Direction::Click).map_err(|e| e.to_string())?;
        }
        "DOUBLE_CLICK" => {
            let x = number(params, "x", 0.0) as i32;
            let y = number(params, "y", 0.0) as i32;
            input.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
            input.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
            std::thread::sleep(std::time::Duration::from_millis(70));
            input.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
        }
        "DRAG" => {
            let x = number(params, "x", 0.0) as i32;
            let y = number(params, "y", 0.0) as i32;
            let end_x = number(params, "endX", x as f64) as i32;
            let end_y = number(params, "endY", y as f64) as i32;
            input.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
            input.button(Button::Left, Direction::Press).map_err(|e| e.to_string())?;
            std::thread::sleep(std::time::Duration::from_millis(100));
            input.move_mouse(end_x, end_y, Coordinate::Abs).map_err(|e| e.to_string())?;
            input.button(Button::Left, Direction::Release).map_err(|e| e.to_string())?;
        }
        "SCROLL" => {
            let amount = number(params, "amount", number(params, "delta", 0.0)) as i32;
            let axis = match string(params, "axis").to_lowercase().as_str() {
                "horizontal" | "x" => Axis::Horizontal,
                _ => Axis::Vertical,
            };
            input.scroll(amount, axis).map_err(|e| e.to_string())?;
        }
        "TYPE_TEXT" | "TYPE_INPUT" => {
            let text = string(params, "text");
            input.text(&text).map_err(|e| e.to_string())?;
        }
        "KEY_PRESS" => {
            let key_name = string(params, "key");
            let key = key_from_name(&key_name).ok_or_else(|| format!("Unsupported key: {}", key_name))?;
            input.key(key, Direction::Click).map_err(|e| e.to_string())?;
        }
        "WAIT" => {
            let ms = number(params, "ms", 0.0).max(0.0) as u64;
            std::thread::sleep(std::time::Duration::from_millis(ms));
        }
        _ => return Err(format!("Unsupported native action: {}", action)),
    }

    Ok(json!({ "action": action, "ok": true }))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let enigo = Mutex::new(Enigo::new(&Settings::default())?);
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());

    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() { continue; }
        let request: Request = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("invalid request: {}", error);
                continue;
            }
        };

        let is_shutdown = request.action == "SHUTDOWN";
        let response = match execute(&enigo, &request.action, &request.params) {
            Ok(result) => success(request.id, result),
            Err(error) => failure(request.id, error),
        };
        serde_json::to_writer(&mut stdout, &response)?;
        stdout.write_all(b"\n")?;
        stdout.flush()?;
        if is_shutdown { break; }
    }

    Ok(())
}
