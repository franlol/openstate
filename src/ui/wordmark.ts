// The name in braille dots, drawn from a bold geometric sans. Each cell holds 2×4 dots, so the curves
// stay smooth where block letters would step; generated once, so nothing depends on the user's fonts.
export type Wordmark = { rows: string[]; letters: number[] }

export const WORDMARK: Record<"big", Wordmark> = {
  big: {
    rows: [
      "                                                 ⣿⣿⡇            ⣿⣿⡇          ",
      "⢀⣴⣾⣿⣿⣷⣦⡀  ⣿⣿⣧⣾⣿⣿⣦⡀  ⣠⣶⣿⣿⣿⣶⡄  ⢸⣿⣿⣴⣿⣿⣷⣄  ⢀⣴⣿⣿⣿⣷⣦  ⣿⣿⣿⣿⡿ ⢀⣴⣿⣿⣿⣷⣦  ⣿⣿⣿⣿⡿ ⢀⣴⣾⣿⣿⣷⣦ ",
      "⣾⣿⡏  ⢹⣿⣷  ⣿⣿⡏  ⢹⣿⣷ ⢰⣿⣿⣁⣀⣈⣿⣿  ⢸⣿⣿  ⢸⣿⣿  ⠸⣿⣿⣄⣀⡉⠉   ⣿⣿⡇  ⠈⠉⣁⣀⣠⣿⣿⡆  ⣿⣿⡇  ⣾⣿⣏⣀⣀⣹⣿⡇",
      "⣿⣿⡇  ⢸⣿⣿  ⣿⣿⡇  ⢸⣿⣿ ⢸⣿⣿⠛⠛⠛⠛⠛⠁ ⢸⣿⣿  ⢸⣿⣿   ⢈⡙⠛⠻⣿⣷⡄  ⣿⣿⡇  ⣴⣿⡟⠛⠉⣿⣿⡇  ⣿⣿⡇  ⣿⣿⡟⠛⠛⠛⠛⠋",
      "⠘⢿⣿⣶⣶⣿⡿⠃  ⣿⣿⣿⣶⣶⣿⡿⠃  ⠻⣿⣷⣶⣾⣿⠟  ⢸⣿⣿  ⢸⣿⣿  ⠘⢿⣷⣶⣶⣿⡿⠃  ⢿⣿⣷⣦ ⢿⣿⣷⣶⡾⣿⣿⡇  ⢿⣿⣷⣦ ⠘⢿⣿⣶⣶⣿⡿⠃",
      "  ⠈⠉⠉⠁    ⣿⣿⡇⠈⠉⠉      ⠉⠉⠉    ⠈⠉⠉  ⠈⠉⠉    ⠉⠉⠉⠁     ⠉⠉⠉  ⠈⠉⠉ ⠉⠉⠁   ⠉⠉⠉   ⠈⠉⠉⠁  ",
      "          ⠿⠿⠇                                                                ",
    ],
    // The first column of each of the nine letters.
    letters: [0, 9, 19, 28, 38, 47, 53, 62, 68],
  },
}

