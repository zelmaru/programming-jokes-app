// tooltips
$(document).ready(function(){
  $('[data-toggle="tooltip"]').tooltip();
});

// copy text on click
function copyElementText(id) {
  var text = document.getElementById(id).value;
  var created = document.createElement("textarea");
  document.body.appendChild(created);
  created.value = text;
  created.select();
  document.execCommand("copy");
  document.body.removeChild(created);
}
