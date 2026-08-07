import SFIcon from './SFIcon'

export default function NoteImageGallery({
  images = [],
  onRemoveImage,
}) {
  if (!images.length) return null

  return (
    <div className="note-images">
      {images.map((image) => (
        <figure key={image.id} className="note-image-card">
          <img
            className="note-image"
            src={image.src}
            alt=""
            draggable={false}
          />
          {onRemoveImage ? (
            <button
              type="button"
              className="note-image-remove"
              onClick={(event) => {
                event.stopPropagation()
                onRemoveImage(image.id)
              }}
              aria-label="Remove image"
              title="Remove image"
            >
              <SFIcon name="xmark" size={11} />
            </button>
          ) : null}
        </figure>
      ))}
    </div>
  )
}
