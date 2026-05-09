"""
Python functions to check for duplicate numbers in a list/array
"""


def has_duplicates_set(numbers):
    """
    Check if there are duplicate numbers using a set.
    Time Complexity: O(n)
    Space Complexity: O(n)
    
    Args:
        numbers: List of numbers to check
        
    Returns:
        bool: True if duplicates exist, False otherwise
    """
    return len(numbers) != len(set(numbers))


def has_duplicates_dict(numbers):
    """
    Check if there are duplicate numbers using a dictionary.
    Time Complexity: O(n)
    Space Complexity: O(n)
    
    Args:
        numbers: List of numbers to check
        
    Returns:
        bool: True if duplicates exist, False otherwise
    """
    seen = {}
    for num in numbers:
        if num in seen:
            return True
        seen[num] = True
    return False


def has_duplicates_sorting(numbers):
    """
    Check if there are duplicate numbers by sorting.
    Time Complexity: O(n log n)
    Space Complexity: O(1) - if sorting in-place
    
    Args:
        numbers: List of numbers to check
        
    Returns:
        bool: True if duplicates exist, False otherwise
    """
    sorted_nums = sorted(numbers)
    for i in range(len(sorted_nums) - 1):
        if sorted_nums[i] == sorted_nums[i + 1]:
            return True
    return False


def has_duplicates_brute_force(numbers):
    """
    Check if there are duplicate numbers using brute force (nested loops).
    Time Complexity: O(n²)
    Space Complexity: O(1)
    
    Args:
        numbers: List of numbers to check
        
    Returns:
        bool: True if duplicates exist, False otherwise
    """
    for i in range(len(numbers)):
        for j in range(i + 1, len(numbers)):
            if numbers[i] == numbers[j]:
                return True
    return False


def get_duplicates(numbers):
    """
    Get all duplicate numbers from a list.
    Time Complexity: O(n)
    Space Complexity: O(n)
    
    Args:
        numbers: List of numbers to check
        
    Returns:
        set: Set of duplicate numbers
    """
    seen = set()
    duplicates = set()
    
    for num in numbers:
        if num in seen:
            duplicates.add(num)
        seen.add(num)
    
    return duplicates


def count_duplicates(numbers):
    """
    Count occurrences of each number and return those that appear more than once.
    Time Complexity: O(n)
    Space Complexity: O(n)
    
    Args:
        numbers: List of numbers to check
        
    Returns:
        dict: Dictionary with duplicate numbers and their counts
    """
    from collections import Counter
    
    counts = Counter(numbers)
    return {num: count for num, count in counts.items() if count > 1}


# Example usage and testing
if __name__ == "__main__":
    # Test cases
    test_cases = [
        [1, 2, 3, 4, 5],                    # No duplicates
        [1, 2, 3, 2, 5],                    # Has duplicates
        [5, 5, 5, 5],                       # All duplicates
        [],                                  # Empty list
        [1],                                 # Single element
        [-1, -2, -1, 0, 1, 2],              # Negative numbers with duplicates
    ]
    
    print("=" * 60)
    print("DUPLICATE NUMBER CHECKER")
    print("=" * 60)
    
    for test in test_cases:
        print(f"\nTest: {test}")
        print(f"  has_duplicates (set):      {has_duplicates_set(test)}")
        print(f"  has_duplicates (dict):     {has_duplicates_dict(test)}")
        print(f"  has_duplicates (sorting):  {has_duplicates_sorting(test)}")
        print(f"  Duplicates found:          {get_duplicates(test)}")
        print(f"  Duplicate counts:          {count_duplicates(test)}")
