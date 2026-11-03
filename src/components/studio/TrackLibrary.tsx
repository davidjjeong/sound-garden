export function TrackLibrary() {
  return (
    <>
      <div className="library-toolbar">
        <div><h1 id="library-title">My library</h1><p>0 tracks</p></div>
        <button className="upload-button" type="button" disabled>+ Upload audio</button>
      </div>
      <input className="library-search" type="search" placeholder="Search your music" aria-label="Search your music" disabled />
      <div className="upload-zone">
        <span className="empty-icon" aria-hidden="true">♫</span>
        <h2>Add your first track</h2>
        <p>Import your music to start shaping its sound.</p>
        <button className="upload-button" type="button" disabled>Choose files</button>

      </div>
    </>
  )
}
