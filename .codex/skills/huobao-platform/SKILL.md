---
name: huobao-platform
description: Operate the Huobao Drama AI platform through its local MCP tools. Use when Codex needs to inspect drama projects or episodes, rewrite an episode script, generate an image, regenerate a standard character view, or poll an asynchronous image generation task.
---

# Huobao Platform

Use the `huobao` MCP tools instead of browser automation for platform data and generation work. Use Chrome only for UI-only workflows or visual acceptance checks.

## Workflow

1. Call `list_dramas` when the user identifies a project by name rather than ID.
2. Call `list_episodes` to resolve an episode number or title to `episodeId`.
3. Call `get_episode` before rewriting to confirm the source exists and inspect current status.
4. Call `rewrite_script` when the user asks to rewrite the episode. The tool writes the result directly.
5. Call `generate_image` with the narrowest relevant context IDs:
   - Use `storyboardId` for a shot.
   - Use `characterId` for a character image.
   - Use `sceneId` for a scene image.
   - Use `episodeId` for episode-level reference collection.
   - Use `dramaId` for a project-associated standalone image.
6. Call `regenerate_character_view` to replace one of `面部特写`, `全身正面`, `全身背面`, or `全身侧面`.
   - Resolve the character ID from platform data before writing.
   - Use `promptOverride` when the existing view has the wrong outfit, hairstyle, pose, camera direction, or visual style.
   - Describe identity, hair, clothing, footwear, rendering style, exact view direction, plain background, and full head-to-toe framing.
   - For matching front/back views, repeat the same identity and outfit wording exactly; change only the camera direction and visibility constraints.
7. When an image tool returns `status: processing`, poll with `get_generation_status`. A generic asynchronous poll stores the image but cannot attach it to a character view, so prefer providers that complete character views synchronously.

## Rules

- Treat tool calls as authorized when the user's request clearly asks for the operation; do not add a second confirmation.
- Never request, expose, or echo provider API keys.
- Do not guess platform IDs. Resolve them with read tools first.
- Do not combine resource IDs from different drama projects.
- Return generated image URLs and identify the affected project or episode.
- On tool errors, report the returned `code` and message. Do not retry authorization, validation, or provider-configuration errors unchanged.
