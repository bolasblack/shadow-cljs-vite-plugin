#!/usr/bin/env python3
"""
Simple YAML frontmatter parser and serializer using only Python stdlib.

Handles markdown files with YAML frontmatter (---\n...\n---).
Preserves types: str, int, float, bool, None.
"""


def parse_frontmatter(content: str) -> tuple[dict[str, str | int | float | bool | None], str]:
    """Parse YAML frontmatter from markdown content with type detection.

    Returns:
        tuple: (frontmatter_dict, body_content)

    Type detection order:
    1. null → None
    2. true/false/yes/no → bool
    3. numbers → int/float
    4. fallback → str

    Quoted values are always parsed as strings.
    """
    if not content.startswith('---'):
        return {}, content

    parts = content.split('---', 2)
    if len(parts) < 3:
        return {}, content

    frontmatter = {}
    for line in parts[1].strip().split('\n'):
        if ':' in line:
            key, value = line.split(':', 1)
            key = key.strip()
            value = value.strip()

            # Empty value
            if not value:
                frontmatter[key] = ""
                continue

            # Check if value is quoted
            is_quoted = (
                (value.startswith('"') and value.endswith('"')) or
                (value.startswith("'") and value.endswith("'"))
            )

            if is_quoted:
                # Quoted value - treat as string
                quote_char = value[0]
                value = value[1:-1]
                # Unescape quotes
                if quote_char == '"':
                    value = value.replace('\\"', '"').replace('\\\\', '\\')
                else:
                    value = value.replace("''", "'")
                frontmatter[key] = value
            else:
                # Unquoted value - try type detection
                frontmatter[key] = _parse_yaml_value(value)

    body = parts[2] if len(parts) > 2 else ""
    return frontmatter, body


def _parse_yaml_value(value: str) -> str | int | float | bool | None:
    """Parse unquoted YAML value with type detection.

    Detection order:
    1. null → None
    2. bool → True/False
    3. number → int/float
    4. fallback → str
    """
    value_lower = value.lower()

    # Check for null
    if value_lower in ('null', '~'):
        return None

    # Check for boolean
    if value_lower in ('true', 'yes', 'on'):
        return True
    if value_lower in ('false', 'no', 'off'):
        return False

    # Check for number
    try:
        # Try int first
        if '.' not in value and 'e' not in value_lower and 'E' not in value:
            return int(value)
        # Try float
        return float(value)
    except ValueError:
        pass

    # Fallback to string
    return value


def serialize_frontmatter(frontmatter: dict[str, str | int | float | bool | None], body: str) -> str:
    """Serialize frontmatter dict back to markdown with YAML frontmatter.

    Uses stdlib-only YAML serialization optimized for AGD files.

    Supported types:
    - None → "null" (unquoted)
    - bool → "true"/"false" (unquoted)
    - int → "123" (unquoted)
    - float → "3.14" (unquoted)
    - str → quoted or unquoted based on content

    Supported cases:
    - Simple strings (alphanumeric, spaces, hyphens, underscores, slashes)
    - Comma-separated values (tags field)
    - Empty/missing values

    Unsupported cases (will raise ValueError):
    - Multiline values
    - Values containing certain special YAML characters
    """
    if not frontmatter:
        return body

    lines = []
    for key, value in frontmatter.items():
        # Validate key
        if not key or not isinstance(key, str):
            raise ValueError(f"Invalid frontmatter key: {key!r}")

        # Handle None
        if value is None:
            lines.append(f"{key}: null")
            continue

        # Handle bool
        if isinstance(value, bool):
            lines.append(f"{key}: {'true' if value else 'false'}")
            continue

        # Handle int/float (check int first since bool is subclass of int)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            lines.append(f"{key}: {value}")
            continue

        # Handle empty string
        if not value:
            lines.append(f"{key}:")
            continue

        # String handling
        # Validate no multiline values
        if '\n' in value or '\r' in value:
            raise ValueError(
                f"Field '{key}' contains multiline value - not supported by stdlib serialization. "
                f"Use single-line values only."
            )

        # Check for YAML special characters that need quoting
        needs_quoting = _needs_yaml_quoting(value)

        if needs_quoting:
            # Validate we can safely quote it
            if '"' in value and "'" in value:
                raise ValueError(
                    f"Field '{key}' contains both single and double quotes - "
                    f"cannot be safely serialized with stdlib YAML."
                )

            # Use double quotes if no double quotes in value, otherwise single
            if '"' not in value:
                escaped_value = value.replace('\\', '\\\\').replace('"', '\\"')
                lines.append(f'{key}: "{escaped_value}"')
            else:
                # Single quotes: only need to escape single quotes by doubling
                escaped_value = value.replace("'", "''")
                lines.append(f"{key}: '{escaped_value}'")
        else:
            # Safe to use unquoted
            lines.append(f"{key}: {value}")

    yaml_content = '\n'.join(lines)
    return f'---\n{yaml_content}\n---\n{body}'


def _needs_yaml_quoting(value: str) -> bool:
    """Check if a YAML value needs quoting.

    Returns True if value contains special YAML characters or is a reserved word.
    """
    # YAML reserved words that need quoting
    yaml_reserved = {
        'true', 'false', 'yes', 'no', 'on', 'off', 'null', '~',
        'True', 'False', 'Yes', 'No', 'On', 'Off', 'Null', 'NULL'
    }

    if value in yaml_reserved:
        return True

    # Check if it looks like a number
    if value.isdigit() or _is_float(value):
        return True

    # Special characters that require quoting
    special_chars = [':', '#', '[', ']', '{', '}', '|', '>', '*', '&', '!', '%', '@', '`', '"', "'"]

    # Leading/trailing spaces
    if value != value.strip():
        return True

    # Contains special YAML characters
    for char in special_chars:
        if char in value:
            return True

    return False


def _is_float(value: str) -> bool:
    """Check if string looks like a float."""
    try:
        float(value)
        return True
    except ValueError:
        return False
