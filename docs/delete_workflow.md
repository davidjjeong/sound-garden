## Delete Workflow

At a high-level:
1. User deletes the track in the browser by clicking the trash icon.
2. This invokes `deleteTrack(trackId)` for the the specific track requested, which calls the `delete-track` endpoint.
3. The endpoint authenticates and identifies the owner, changes the status of the track from `ready` to `deleting` in the database.
4. Then, the edge function removes the corresponding audio file from the storage, and deletes the database record at the end.
5. Browser removes the track row in the library.

Key design choice is that we remove the database row last. If file deletion fails, we still have the track ID and Storage path to retry.

### 1. Click the trash icon

Clicking the trash button calls

```typescript
deletion.choose(track)
```

where `track` contains the ID and its title. 

### 2. useTrackDeletion hook stores the track

```typescript
targetRef.current = track
setTarget(track)
setOpen(true)
```

`targetRef.current` retains the current track for deletion request and retries. `target` lets React display its title, and `isOpen` tells react to show the dialog, e.g.

```
Delete track?
"Soft Orbit" will be permanently removed from your library and storage.
```

If user presses Cancel, the dialog is closed and no request is sent to the server endpoint.

### 3. User confirms deletion

User confirms the track deletion, which calls `handleDelete()` in `TrackLibrary.tsx` and thus calls:
```typescript
const id = await deletion.confirm()
```
`confirm()` sets:
```typescript
busy.current = true
setDeleting(true)
```
which prevents another request from a double-click and makes the dialog show **Deleting...**.

### 4. Browser sends track ID to backend

Hook calls 
```typescript
await deleteTrack(attempt.id)
```
This helper function in `tracks.ts` validates the track ID and sends:
```typescript
const { data, error } = await supabase.functions.invoke<unknown>('delete-track', {
    body: { trackId: id },
})
```

### 5. Edge function verifies user identity

Endpoint validates the signed-in user authentication token using
```typescript
auth.getUser(token)
```

### 6. Database checks ownership and marks the track deleting

Endpoint calls `"begin_track_deletion"` PostgreSQL function, which searches for track using the provided user and track ID. It locks the row (other database operations need to wait until this function's transaction finishes), and changes the status from `ready` to `deleting`. The function returns the row, including its Storage path (e.g. `user-A/track-123.mp3`).

### 7. Endpoint checks the returned file path and removes the actual audio file

Before removing anything, the edge function checks that the returned path from the previous function `"begin_track_deletion"` has:
- requested track ID
- authenticated owner
- status `deleting`
- Allowed MP3/WAV type
- Expected owner-and-track Storage path

Once the checks pass, the endpoint removes the actual audio file in Storage. Corresponding row in the database is not deleted yet; status `deleting` remains right now.

### 8. Endpoint removes the database row

Only after Storage succeeds does it call:
```typescript
admin.rpc('finish_track_deletion', {
  p_user_id: user.id,
  p_track_id: trackId,
})
```

SQL function checks ownership, locks the row, and removes the corresponding track row in the database.

### 9. Backend confirms success

Endpoint returns
```json
{
    action: "deleted",
    trackId: "track-123",
}
```
Browser helper checks that the response says deleted and contains the expected track ID. Only then is the ID returned to the hook.