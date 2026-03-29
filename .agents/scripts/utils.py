#!/usr/bin/env python3
"""
Shared utilities for Agent Centric framework.

DO NOT MODIFY THIS FILE - it will be automatically updated from the skill directory.
To disable auto-update, add this filename to disableAutoUpdateScripts in config.json.
"""

import re
from pathlib import Path

# Constants
AGENTS_DIR = '.agents'
DECISIONS_DIR = 'decisions'
AGD_PATTERN = 'AGD-*.md'
REF_FIELDS = ['obsoleted_by', 'updated_by', 'updates', 'obsoletes']


def get_agd_id(filename: str) -> str | None:
    """Extract AGD ID from filename (e.g., AGD-001 from AGD-001_name.md)."""
    match = re.match(r'(AGD-\d+)', filename)
    return match.group(1) if match else None


def get_agd_sort_key(path: str) -> int:
    """Extract AGD number as integer for sorting."""
    match = re.search(r'AGD-(\d+)', path)
    return int(match.group(1)) if match else 0


def find_agd_file(decisions_dir: Path, agd_ref: str) -> Path | None:
    """Find AGD file by its number reference."""
    agd_id = get_agd_id(agd_ref)
    if not agd_id:
        return None

    for f in decisions_dir.glob(f'{agd_id}_*.md'):
        return f
    return None


def get_decisions_dir(project_dir: Path) -> Path:
    """Get the decisions directory path."""
    return project_dir / AGENTS_DIR / DECISIONS_DIR


def get_agents_dir(project_dir: Path) -> Path:
    """Get the .agents directory path."""
    return project_dir / AGENTS_DIR
