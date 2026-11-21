const params = new URLSearchParams(location.search);
document.getElementById("server").value = params.get("server") || "";
document.getElementById("message").textContent = params.get("message") || "";
