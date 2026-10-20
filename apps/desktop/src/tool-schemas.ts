export const toolInputSchemas = {
  "list_installed_apps": {
    "type": "object",
    "properties": {},
    "required": [],
    "additionalProperties": false
  },
  "open_app": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string"
      },
      "selection": {
        "type": "string"
      }
    },
    "required": [
      "name"
    ],
    "additionalProperties": false
  },
  "list_running_apps": {
    "type": "object",
    "properties": {},
    "required": [],
    "additionalProperties": false
  },
  "close_app": {
    "type": "object",
    "properties": {
      "pid": {
        "type": "number"
      },
      "name": {
        "type": "string"
      }
    },
    "required": [],
    "anyOf": [
      {
        "required": [
          "pid"
        ]
      },
      {
        "required": [
          "name"
        ]
      }
    ],
    "additionalProperties": false
  },
  "window_control": {
    "type": "object",
    "properties": {
      "pid": {
        "type": "number"
      },
      "action": {
        "type": "string",
        "enum": [
          "minimize",
          "maximize",
          "restore",
          "close",
          "focus",
          "left",
          "right",
          "monitor_next",
          "minimize_all"
        ]
      },
      "name": {
        "type": "string"
      }
    },
    "required": [
      "action"
    ],
    "additionalProperties": false
  },
  "open_website": {
    "type": "object",
    "properties": {
      "url": {
        "type": "string"
      }
    },
    "required": [
      "url"
    ],
    "additionalProperties": false
  },
  "youtube_search": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string"
      },
      "mode": {
        "type": "string",
        "enum": [
          "results",
          "first"
        ]
      }
    },
    "required": [
      "query",
      "mode"
    ],
    "additionalProperties": false
  },
  "system_volume": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": [
          "up",
          "down",
          "mute"
        ]
      }
    },
    "required": [
      "action"
    ],
    "additionalProperties": false
  },
  "screen_brightness": {
    "type": "object",
    "properties": {
      "percent": {
        "type": "number"
      }
    },
    "required": [
      "percent"
    ],
    "additionalProperties": false
  },
  "system_radio": {
    "type": "object",
    "properties": {
      "device": {
        "type": "string",
        "enum": [
          "wifi",
          "bluetooth",
          "airplane"
        ]
      },
      "enabled": {
        "type": "boolean"
      }
    },
    "required": [
      "device",
      "enabled"
    ],
    "additionalProperties": false
  },
  "dark_mode": {
    "type": "object",
    "properties": {
      "enabled": {
        "type": "boolean"
      }
    },
    "required": [
      "enabled"
    ],
    "additionalProperties": false
  },
  "lock_screen": {
    "type": "object",
    "properties": {},
    "required": [],
    "additionalProperties": false
  },
  "sleep_pc": {
    "type": "object",
    "properties": {},
    "required": [],
    "additionalProperties": false
  },
  "open_folder": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string"
      }
    },
    "required": [
      "path"
    ],
    "additionalProperties": false
  },
  "find_file": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string"
      },
      "root": {
        "type": "string"
      }
    },
    "required": [
      "name"
    ],
    "additionalProperties": false
  },
  "open_file": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string"
      }
    },
    "required": [
      "path"
    ],
    "additionalProperties": false
  },
  "move_file": {
    "type": "object",
    "properties": {
      "source": {
        "type": "string"
      },
      "destination": {
        "type": "string"
      }
    },
    "required": [
      "source",
      "destination"
    ],
    "additionalProperties": false
  },
  "delete_file": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string"
      }
    },
    "required": [
      "path"
    ],
    "additionalProperties": false
  },
  "screenshot": {
    "type": "object",
    "properties": {},
    "required": [],
    "additionalProperties": false
  },
  "clipboard_read": {
    "type": "object",
    "properties": {},
    "required": [],
    "additionalProperties": false
  },
  "clipboard_write": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "ui_automation": {
    "type": "object",
    "properties": {
      "pid": {
        "type": "number"
      },
      "automationId": {
        "type": "string"
      },
      "action": {
        "type": "string",
        "enum": [
          "invoke",
          "set_value",
          "toggle"
        ]
      },
      "value": {
        "type": "string"
      },
      "expectedName": {
        "type": "string"
      }
    },
    "required": [
      "pid",
      "automationId",
      "action"
    ],
    "additionalProperties": false
  },
  "ui_inspect": {
    "type": "object",
    "properties": {
      "pid": {
        "type": "number"
      },
      "limit": {
        "type": "number"
      }
    },
    "required": [
      "pid"
    ],
    "additionalProperties": false
  }
} as const;
