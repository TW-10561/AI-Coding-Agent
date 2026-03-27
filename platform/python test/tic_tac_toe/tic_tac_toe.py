#!/usr/bin/env python3
"""
Tic Tac Toe CLI Game
A simple two-player Tic Tac Toe game that runs in the terminal.
"""

import os


class TicTacToe:
    """Tic Tac Toe game logic and UI."""

    def __init__(self):
        self.board = [" "] * 9
        self.current_player = "X"
        self.moves_count = 0
        self.game_running = True
        self.winner = None

    def clear_screen(self):
        """Clear the terminal screen."""
        os.system("cls" if os.name == "nt" else "clear")

    def draw_board(self):
        """Draw the game board in the terminal."""
        print("\n" + "=" * 50)
        print("\n    TIC TAC TOE    ")
        print("\n" + "=" * 50)
        print()
        print("     |     |     ")
        print(f"  {self.board[0]}  |  {self.board[1]}  |  {self.board[2]}  ")
        print("     |     |     ")
        print("    -----+-----+----")
        print("     |     |     ")
        print(f"  {self.board[3]}  |  {self.board[4]}  |  {self.board[5]}  ")
        print("     |     |     ")
        print("    -----+-----+----")
        print("     |     |     ")
        print(f"  {self.board[6]}  |  {self.board[7]}  |  {self.board[8]}  ")
        print("     |     |     ")
        print()
        print("=" * 50)

    def get_position(self, cell_number):
        """Convert cell number (1-9) to board index (0-8)."""
        return cell_number - 1

    def is_valid_move(self, position):
        """Check if a move is valid."""
        return 0 <= position < 9 and self.board[position] == " "

    def make_move(self, position):
        """Make a move on the board."""
        if self.is_valid_move(position):
            self.board[position] = self.current_player
            self.moves_count += 1
            return True
        return False

    def check_winner(self):
        """Check if there's a winner or it's a draw."""
        winning_combinations = [
            [0, 1, 2],  # Top row
            [3, 4, 5],  # Middle row
            [6, 7, 8],  # Bottom row
            [0, 3, 6],  # Left column
            [1, 4, 7],  # Middle column
            [2, 5, 8],  # Right column
            [0, 4, 8],  # Main diagonal
            [2, 4, 6],  # Anti-diagonal
        ]

        for combo in winning_combinations:
            a, b, c = combo
            if self.board[a] != " " and self.board[a] == self.board[b] == self.board[c]:
                self.winner = self.board[a]
                self.game_running = False
                return True

        if self.moves_count >= 9:
            self.winner = "Draw"
            self.game_running = False
            return True

        return False

    def switch_player(self):
        """Switch to the next player."""
        self.current_player = "O" if self.current_player == "X" else "X"

    def display_winner_message(self):
        """Display the winner or draw message."""
        print()
        if self.winner == "Draw":
            print("     IT'S A DRAW!     ")
        else:
            print(f"     PLAYER {self.winner} WINS!     ")
        print()

    def display_instructions(self):
        """Display game instructions."""
        print("\n" + "=" * 50)
        print("INSTRUCTIONS:")
        print("-" * 50)
        print("1. Enter a number from 1-9 to place your mark.")
        print("2. The board positions are numbered as follows:")
        print()
        print("     1 | 2 | 3")
        print("    ---+---+---")
        print("     4 | 5 | 6")
        print("    ---+---+---")
        print("     7 | 8 | 9")
        print()
        print("3. Players X and O alternate turns.")
        print("4. The first player to align 3 marks wins.")
        print("=" * 50)

    def get_player_input(self):
        """Get valid player input."""
        while True:
            try:
                position = int(input(f"\nEnter position (1-9) for player {self.current_player}: "))
                if 1 <= position <= 9:
                    if self.is_valid_move(position - 1):
                        return position - 1
                    else:
                        print("Position already taken! Try again.")
                else:
                    print("Invalid input! Please enter a number between 1 and 9.")
            except ValueError:
                print("Invalid input! Please enter a number.")

    def play(self):
        """Main game loop."""
        self.clear_screen()
        self.display_instructions()

        while self.game_running:
            self.draw_board()

            if self.moves_count > 0:
                print(f"\nTurn {self.moves_count + 1}: Player {self.current_player}'s move")

            position = self.get_player_input()
            self.make_move(position)

            if self.check_winner():
                self.clear_screen()
                self.draw_board()
                self.display_winner_message()
                break

            self.switch_player()
            self.clear_screen()

        self.play_again()

    def play_again(self):
        """Ask player if they want to play again."""
        print()
        while True:
            choice = input("Would you like to play again? (y/n): ").lower()
            if choice == "y":
                self.__init__()
                self.play()
                break
            elif choice == "n":
                print("\nThanks for playing Tic Tac Toe! Goodbye!\n")
                break
            else:
                print("Invalid choice! Please enter 'y' or 'n'.")


def main():
    """Entry point for the game."""
    game = TicTacToe()
    game.play()


if __name__ == "__main__":
    main()
