"""
Bubble Sort Algorithm Implementation
=====================================

Bubble Sort is a simple sorting algorithm that repeatedly steps through the list,
compares adjacent elements, and swaps them if they are in the wrong order.

Time Complexity:
- Best: O(n) - when array is already sorted
- Average: O(n^2)
- Worst: O(n^2)

Space Complexity: O(1) - in-place sorting

How it works:
=============
The algorithm gets its name because larger elements "bubble" to the end of the array
in each pass. After the first pass, the largest element is at the end. After the
second pass, the second largest is at position n-1, and so on.
"""


def bubblesort(arr):
    """
    Sort a list using the Bubble Sort algorithm.
    
    Args:
        arr: List of comparable elements (numbers, strings, etc.)
    
    Returns:
        list: New sorted list (original list is not modified)
    
    Example:
        >>> bubble_sort([5, 3, 8, 2, 1])
        [1, 2, 3, 5, 8]
    """
    # Create a copy to avoid modifying the original list
    arr = list(arr)
    n = len(arr)
    
    # Traverse through all elements
    for i in range(n):
        # Flag to optimize: if no swaps, array is already sorted
        swapped = False
        
        # Last i elements are already in place
        for j in range(0, n - i - 1):
            # Swap if element at j is greater than element at j+1
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
                swapped = True
        
        # If no swaps occurred in this pass, array is sorted
        if not swapped:
            break
    
    return arr


def bubble_sort_in_place(arr):
    """
    Sort a list in-place using Bubble Sort.
    
    Args:
        arr: List of comparable elements (modified directly)
    
    Returns:
        None (list is modified in-place)
    
    Example:
        >>> arr = [5, 3, 8, 2, 1]
        >>> bubble_sort_in_place(arr)
        >>> print(arr)
        [1, 2, 3, 5, 8]
    """
    n = len(arr)
    
    for i in range(n):
        swapped = False
        
        for j in range(0, n - i - 1):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
                swapped = True
        
        if not swapped:
            break


def bubble_sort_with_steps(arr):
    """
    Sort a list using Bubble Sort, returning each step for visualization.
    
    Args:
        arr: List of comparable elements
    
    Returns:
        list: List of tuples (current_array, description)
    
    Example:
        >>> steps = bubble_sort_with_steps([5, 3, 8, 2, 1])
        >>> for arr, desc in steps:
        ...     # Visualize sorting process
    """
    arr = list(arr)
    n = len(arr)
    steps = []
    
    steps.append((list(arr), "Initial array"))
    
    for i in range(n):
        swapped = False
        
        for j in range(0, n - i - 1):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
                swapped = True
                steps.append((list(arr), f"Swapped {arr[j+1]} and {arr[j]} at positions {j} and {j+1}"))
        
        if not swapped:
            steps.append((list(arr), f"Sorted after pass {i+1} (no swaps)"))
            break
    
    return steps


# ============================================================================
# Demo and Test Cases
# ============================================================================

if __name__ == "__main__":
    print("=" * 60)
    print("Bubble Sort Algorithm Demo")
    print("=" * 60)
    
    # Test cases
    test_cases = [
        ([5, 3, 8, 2, 1], "Random order"),
        ([1, 2, 3, 4, 5], "Already sorted"),
        ([5, 4, 3, 2, 1], "Reverse order"),
        ([3, 3, 3, 3], "All equal elements"),
        ([1], "Single element"),
        ([], "Empty list"),
        ([-5, 10, -15, 20, 0], "Mixed positive/negative"),
    ]
    
    for arr, description in test_cases:
        print(f"\nTest: {description}")
        print(f"Input: {arr}")
        
        # Show sorting steps
        if len(arr) <= 5:
            steps = bubble_sort_with_steps(arr)
            print("Steps:")
            for arr_state, desc in steps:
                print(f"  {desc}: {arr_state}")
        else:
            result = bubble_sort(arr)
            print(f"Result: {result}")
    
    # Performance comparison
    print("\n" + "=" * 60)
    print("Performance Comparison")
    print("=" * 60)
    
    import random
    import time
    
    # Generate large random array
    large_arr = [random.randint(1, 10000) for _ in range(100)]
    
    # Time the sort
    start = time.time()
    sorted_arr = bubble_sort(large_arr)
    elapsed = time.time() - start
    
    print(f"Sorted {len(large_arr)} elements in {elapsed:.4f} seconds")
    print(f"First 5 elements: {sorted_arr[:5]}")
    print(f"Last 5 elements: {sorted_arr[-5:]}")
