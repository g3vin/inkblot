/** The Paragraph Style menu's choices for each way a document is written. */
import { BlockType, WritingFormat } from '../../../types'

const PROSE = [[BlockType.Paragraph, 'Body'], [BlockType.Heading1, 'Heading 1'], [BlockType.Heading2, 'Heading 2'], [BlockType.Heading3, 'Heading 3']]
const SCREENPLAY = [[BlockType.SceneHeading, 'Scene heading'], [BlockType.Action, 'Action'], [BlockType.Character, 'Character'], [BlockType.Parenthetical, 'Parenthetical'], [BlockType.Dialogue, 'Dialogue'], [BlockType.Transition, 'Transition'], [BlockType.Shot, 'Shot'], [BlockType.Centered, 'Centered']]
const STAGEPLAY = [[BlockType.ActHeading, 'Act'], [BlockType.SceneTitle, 'Scene'], [BlockType.StageDirection, 'Stage direction'], [BlockType.StageCharacter, 'Character'], [BlockType.Parenthetical, 'Parenthetical'], [BlockType.StageDialogue, 'Dialogue']]

export const blockOptions = (format) => (
  format === WritingFormat.Screenplay ? SCREENPLAY : format === WritingFormat.Stageplay ? STAGEPLAY : PROSE
)
