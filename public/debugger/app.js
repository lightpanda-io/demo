// lightpanda-debugger-fixture
function compute(a, b) {
    const sum = a + b;
    return sum;
}

debugger;
document.getElementById('result').textContent = 'done:' + compute(40, 2);
