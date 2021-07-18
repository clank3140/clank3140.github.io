$(function () {
    $(window).scroll(function () {
        var value = $(this).scrollTop(); //スクロールの値を取得
        $('#scrollValue').text(value);

        $('.naname').css('margin-top', 100 - value / 6);
        $('#video_1').css('margin-top', 150 - value / 2);
        $('#video_2').css('margin-top', 500 - value / 1.5);
        $('#portfolio').css('margin-top', 600 - value);
    });
});