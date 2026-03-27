"""
Bubble Sort Implementation in Python
A simple comparison-based sorting algorithm with O(n²) time complexity.
"""

from typing import List, T


def bubble_sort(arr: List[T]) -> List[T]:
    """
    Sort a list using the bubble sort algorithm.
    
    Args:
        arr: List of comparable elements
    
    Returns:
        A new sorted list
    """
    arr = arr.copy()  # Don't modify original
    n = len(arr)
    
    # Traverse through all array elements
    for i in range(n - 1):
        # Last i elements are already in place
        for j in range(n - i - 1):
            # Swap if element found greater than next element
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
    
    return arr


def bubble_sort_in_place(arr: List[T]) -> None:
    """
    Sort a list in-place using bubble sort algorithm.
    
    Args:
        arr: List to sort (modified in-place)
    """
    n = len(arr)
    
    # Traverse through all array elements
    for i in range(n - 1):
        # Last i elements are already in place
        for j in range(n - i - 1):
            # Swap if element found greater than next element
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]


def bubblesort_optimized(arr: List[T]) -> List[T]:
    """
    Optimized bubble sort that stops early if no swaps occur.
    
    Args:
        arr: List of comparable elements
    
    Returns:
        A new sorted list
    """
    arr = arr.copy()  # Don't modify original
    n = len(arr)
    
    # Traverse through all array elements
    for i in range(n - 1):
        swapped = False
        # Last i elements are already in place
        for j in range(n - i - 1):
            # Swap if element found greater than next element
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
                swapped = True
        
        # If no swaps occurred, array is already sorted
        if not swapped:
            break
    
    return arr


def cocktail_sort(arr: List[T]) -> List[T]:
    """
    Cockail sort (bidirectional bubble sort) - variation that sorts both directions.
    Often called "cocktail sort" or "shaker sort".
    
    Args:
        arr: List of comparable elements
    
    Returns:
        A new sorted list
    """
    arr = arr.copy()  # Don't modify original
    n = len(arr)
    
    if n <= 1:
        return arr
    
    left = 0
    right = n - 1
    last_swap = 0
    
    while left < right:
        # Forward pass (bubble largest to end)
        for i in range(left, right):
            if arr[i] > arr[i + 1]:
                arr[i], arr[i + 1] = arr[i + 1], arr[i]
                last_swap = i
        
        right = last_swap
        
        if left >= right:
            break
        
        # Backward pass (bubble smallest to start)
        for i in range(right, left, -1):
            if arr[i] < arr[i - 1]:
                arr[i], arr[i - 1] = arr[i - 1], arr[i]
                last_swap = i
        
        left = last_swap
    
    return arr


# Example usage
if __name__ == "__main__":
    # Test with integers
    numbers = [38, 7, 26, 19, 5, 42, 31]
    sorted_numbers = bubble_sort(numbers)
    print(f"Original: {numbers}")
    print(f"Sorted:   {sorted_numbers}")
    
    # Test with strings
    words = ["banana", "apple", "cherry", "date"]
    sorted_words = bubble_sort(words)
    print(f"Original: {words}")
    print(f"Sorted:   {sorted_words}")
    
    # Demonstrate in-place sorting
    data = [64, 31, 12, 87, 5]
    bubble_sort_in_place(data)
    print(f"In-place sorted: {data}")
    
    # Test optimized version
    nearly_sorted = [1, 2, 3, 5, 4, 6, 7]
    print(f"Optimized sort: {bubblesort_optimized(nearly_sorted)}")
    
    # Test cocktail sort
    random_data = [5, 3, 8, 1, 4, 2, 7, 6]
    print(f"Cocktail sort: {cocktail_sort(random_data)}")
