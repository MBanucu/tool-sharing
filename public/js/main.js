document.addEventListener('DOMContentLoaded', () => {
    window.deleteTool = async (toolId) => {
        if (confirm('Are you sure you want to delete this tool?')) {
            try {
                const res = await fetch(`/delete/${toolId}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${document.cookie.split('; ').find(row => row.startsWith('token='))?.split('=')[1]}`
                    }
                });
                if (res.ok) {
                    window.location.reload(); // Refresh the page to reflect the deletion
                } else {
                    alert('Error deleting tool');
                }
            } catch (err) {
                console.error('Delete error:', err);
                alert('An error occurred while deleting the tool');
            }
        }
    };
});