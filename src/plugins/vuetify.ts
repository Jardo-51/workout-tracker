import {
  mdiArrowLeft,
  mdiCog,
  mdiDeleteOutline,
  mdiDumbbell,
  mdiHistory,
  mdiHome,
  mdiNoteEditOutline,
  mdiPlayCircle,
  mdiStarOutline,
  mdiTimerSand,
} from '@mdi/js'
import { createVuetify } from 'vuetify'
import { mdi, aliases as vuetifyAliases } from 'vuetify/iconsets/mdi-svg'
import 'vuetify/styles'

/**
 * The app's icons, on top of the aliases Vuetify's own components resolve
 * ($dropdown, $clear, $checkboxOn, …). Referenced from templates as `$home`
 * and so on.
 *
 * Every icon is named here rather than pulled in as a webfont: @mdi/font ships
 * the whole Material Design Icons set (~400 KB as woff2, ~3.5 MB across the
 * four formats it declares) for the handful of glyphs this app draws, and the
 * service worker precaches all of it. These paths tree-shake down to the ones
 * actually imported. Adding an icon to a template means adding it here first.
 */
const aliases = {
  ...vuetifyAliases,
  arrowLeft: mdiArrowLeft,
  cog: mdiCog,
  deleteOutline: mdiDeleteOutline,
  dumbbell: mdiDumbbell,
  history: mdiHistory,
  home: mdiHome,
  noteEdit: mdiNoteEditOutline,
  playCircle: mdiPlayCircle,
  starOutline: mdiStarOutline,
  timerSand: mdiTimerSand,
}

export default createVuetify({
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: { mdi },
  },
  theme: {
    defaultTheme: 'light',
  },
})
