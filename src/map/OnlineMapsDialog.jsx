/**
 * OnlineMapsDialog.jsx — asked once, before a map first fetches anything from the
 * internet (satellite pictures, streets, terrain, a search for a real place).
 *
 * Says what is fetched, from whom, and what they see; the answer is kept in
 * Settings ▸ Maps, where it can be changed.
 */
import { Button, Dialog } from '../ui'

export default function OnlineMapsDialog({ open, onAllow, onCancel }) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      eyebrow="Maps"
      title="Use online maps?"
      description="Satellite pictures, street detail and terrain are downloaded as you look around. The services that send them see which part of the world you are looking at. Nothing from your project leaves this computer."
      footer={
        <>
          <Button onClick={onCancel}>Not now</Button>
          <Button variant="filled" onClick={onAllow}>Use online maps</Button>
        </>
      }
    >
      <p className="ib-hint">You can turn this off, or choose where satellite pictures come from, in Settings ▸ Maps.</p>
    </Dialog>
  )
}
